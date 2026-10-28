import type { BrowserWindow } from "electron";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ConfigStore } from "../src/electron/main/configStore";
import { DanmakuController } from "../src/electron/main/danmakuController";
import { RequestTooLargeError } from "../src/electron/main/providers/errors";
import { LATEST_COMMENTS_LABEL } from "../src/electron/main/runtime/contextSummarizer";
import type { GenerationLogStore } from "../src/electron/main/generationLogStore";
import type {
  AppConfig,
  ContextSummaryResult,
  DanmakuGenerationResult,
  DanmakuInput,
  DeepPartial,
  GenerationLogEntry,
  RuntimeSettings,
  RuntimeStatus,
} from "../src/shared/types";
import { makeConfig, makeSnapshot } from "./helpers";

const mocks = vi.hoisted(() => ({
  generate: vi.fn<(input: DanmakuInput, config: AppConfig) => Promise<DanmakuGenerationResult>>(),
  summarize: vi.fn<(input: DanmakuInput, config: AppConfig, maxChars: number) => Promise<ContextSummaryResult>>(),
  capture: vi.fn(),
}));

vi.mock("../src/electron/main/capture/screenCapture", () => ({
  capturePrimaryScreen: mocks.capture,
  shrinkSnapshotToFit: () => undefined,
}));
vi.mock("../src/electron/main/configStore", () => ({ ConfigStore: class {} }));
vi.mock("../src/electron/main/generationLogStore", () => ({ GenerationLogStore: class {} }));
vi.mock("../src/electron/main/providers/openAiCompatibleProvider", () => ({
  OpenAICompatibleProvider: class {
    generateDanmaku = mocks.generate;
    generateSummary = mocks.summarize;
  },
}));

const controllers: DanmakuController[] = [];

afterEach(() => {
  controllers.splice(0).forEach((controller) => controller.shutdown());
  mocks.generate.mockReset();
  mocks.summarize.mockReset();
  mocks.capture.mockReset();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function reply(text: string): DanmakuGenerationResult {
  return {
    items: [{ id: text, text, createdAt: "" }],
    userText: "",
    assistantText: JSON.stringify({ comments: [text] }),
  };
}

function providerError(status: number): Error {
  return new Error(`Model request failed at http://llm.test/v1/chat/completions (${status}): failed`);
}

/** The next request stays open until resolved, and rejects like fetch when aborted. */
function pendingRequest(): { resolve(text: string): void } {
  let resolveRequest: ((result: DanmakuGenerationResult) => void) | undefined;
  mocks.generate.mockImplementationOnce(
    (input) =>
      new Promise((resolve, reject) => {
        resolveRequest = resolve;
        input.abortSignal?.addEventListener("abort", () => reject(new Error("This operation was aborted")));
      }),
  );
  return { resolve: (text) => resolveRequest?.(reply(text)) };
}

function setup(runtime: Partial<RuntimeSettings> = {}) {
  const config = makeConfig({
    model: { visionEnabled: true },
    runtime: {
      intervalMinSeconds: 1800,
      intervalMaxSeconds: 1800,
      startDelaySeconds: 0,
      releaseWindowMinSeconds: 0,
      releaseWindowMaxSeconds: 0,
      historyRounds: 4,
      historyMode: "sliding",
      historyIncludeImages: true,
    },
  });
  Object.assign(config.runtime, runtime);
  const configStore = {
    get: vi.fn(async () => config),
    update: vi.fn(async (patch: DeepPartial<AppConfig>) => {
      Object.assign(config.runtime, patch.runtime);
      return config;
    }),
  };
  const logs: GenerationLogEntry[] = [];
  const logStore = {
    append: vi.fn(async (entry: GenerationLogEntry) => {
      logs.push(entry);
    }),
  };
  const sent: string[] = [];
  const overlay = {
    isDestroyed: () => false,
    webContents: { send: (channel: string) => sent.push(channel) },
  };
  const statuses: RuntimeStatus[] = [];
  const controller = new DanmakuController(
    configStore as unknown as ConfigStore,
    logStore as unknown as GenerationLogStore,
    () => overlay as unknown as BrowserWindow,
    (status) => statuses.push(status),
  );
  controllers.push(controller);
  return { controller, config, configStore, logs, sent, statuses };
}

function sentHistory(call: number): boolean[] {
  return (mocks.generate.mock.calls[call][0].history ?? []).map((round) => Boolean(round.snapshot));
}

describe("DanmakuController", () => {
  it("stop() aborts a timer request instead of logging its result as a success", async () => {
    const h = setup();
    pendingRequest();
    await h.controller.start();
    await vi.waitFor(() => expect(mocks.generate).toHaveBeenCalledTimes(1));

    expect((await h.controller.stop()).state).toBe("paused");
    await vi.waitFor(() => expect(h.logs).toHaveLength(1));

    expect(mocks.generate.mock.calls[0][0].abortSignal?.aborted).toBe(true);
    expect(h.logs[0].status).toBe("aborted");
    expect(h.controller.getStatus()).toMatchObject({ state: "paused", cycles: 0, lastError: undefined });
    expect(h.statuses.at(-1)?.state).toBe("paused");
  });

  it("lets a manual request finish after stop() and stays paused", async () => {
    const h = setup();
    mocks.generate.mockRejectedValueOnce(providerError(502));
    expect((await h.controller.generateOnce("manual")).state).toBe("error");
    mocks.generate.mockResolvedValueOnce(reply("first"));
    expect((await h.controller.generateOnce("manual")).state).toBe("idle");

    await h.controller.stop();
    const request = pendingRequest();
    const run = h.controller.generateOnce("manual");
    await vi.waitFor(() => expect(mocks.generate).toHaveBeenCalledTimes(3));
    await h.controller.stop();
    request.resolve("shown");

    expect(await run).toMatchObject({ state: "paused", cycles: 2 });
    expect(mocks.generate.mock.calls[2][0].abortSignal?.aborted).toBe(false);
    // Log entries are numbered per attempt, so a failed one does not share a number.
    expect(h.logs.map((entry) => [entry.cycle, entry.status])).toEqual([
      [1, "error"],
      [2, "success"],
      [3, "success"],
    ]);
  });

  it("does not bring back a round that was in flight when history was cleared", async () => {
    const h = setup();
    const request = pendingRequest();
    const run = h.controller.generateOnce("manual");
    await vi.waitFor(() => expect(mocks.generate).toHaveBeenCalledTimes(1));
    h.controller.clearHistory();
    request.resolve("stale");
    await run;

    mocks.generate.mockImplementation(async () => reply("next"));
    await h.controller.generateOnce("manual");
    expect(sentHistory(1)).toEqual([]);
    // Only history was cleared, so the comments are still shown.
    await vi.waitFor(() => expect(h.sent).toEqual(["danmaku:items", "danmaku:items"]));
  });

  it("clearOverlay() drops pending comments, in-flight comments and history", async () => {
    vi.useFakeTimers();
    // vi.waitFor advances fake timers while polling; keep release delays well clear of that.
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const h = setup({ releaseWindowMinSeconds: 30, releaseWindowMaxSeconds: 30 });
    mocks.generate.mockImplementation(async () => reply("waiting"));
    await h.controller.generateOnce("manual");
    const request = pendingRequest();
    const run = h.controller.generateOnce("manual");
    await vi.waitFor(() => expect(mocks.generate).toHaveBeenCalledTimes(2));

    h.controller.clearOverlay();
    request.resolve("stale");
    await run;
    await vi.advanceTimersByTimeAsync(60_000);

    expect(h.sent).toEqual(["overlay:clear"]);
    await h.controller.generateOnce("manual");
    expect(sentHistory(2)).toEqual([]);
  });

  it("stops sending stored screenshots once history images are turned off", async () => {
    const h = setup();
    mocks.capture.mockResolvedValue(makeSnapshot(1000));
    mocks.generate.mockImplementation(async () => reply("x"));
    await h.controller.generateOnce("manual");
    await h.controller.generateOnce("manual");
    expect(sentHistory(1)).toEqual([true]);

    h.config.runtime.historyIncludeImages = false;
    await h.controller.generateOnce("manual");
    expect(sentHistory(2)).toEqual([false, false]);
  });

  it("shrinks history after errors that would repeat, but not after transient ones", async () => {
    const h = setup();
    mocks.capture.mockResolvedValue(makeSnapshot(1000));
    mocks.generate.mockImplementation(async () => reply("x"));
    await h.controller.generateOnce("manual");
    await h.controller.generateOnce("manual");
    mocks.generate
      .mockRejectedValueOnce(providerError(502))
      .mockRejectedValueOnce(providerError(400))
      .mockRejectedValueOnce(providerError(400));
    for (let index = 0; index < 4; index += 1) {
      await h.controller.generateOnce("manual");
    }

    expect(mocks.generate.mock.calls.map((_call, index) => sentHistory(index))).toEqual([
      [],
      [true],
      [true, true],
      [true, true],
      [false, false],
      [],
    ]);
    expect(h.logs.map((entry) => entry.historyRecovery)).toEqual([
      undefined,
      undefined,
      undefined,
      "images",
      "reset",
      undefined,
    ]);
  });

  it("keeps the countdown across config saves unless the interval changed", async () => {
    vi.useFakeTimers();
    const h = setup({ intervalMinSeconds: 100, intervalMaxSeconds: 100 });
    mocks.generate.mockImplementation(async () => reply("x"));
    await h.controller.start();
    await vi.waitFor(() => expect(h.logs).toHaveLength(1));

    await vi.advanceTimersByTimeAsync(60_000);
    await h.controller.refreshSchedule();
    await vi.advanceTimersByTimeAsync(40_000);
    await vi.waitFor(() => expect(h.logs).toHaveLength(2));

    Object.assign(h.config.runtime, { intervalMinSeconds: 5, intervalMaxSeconds: 5 });
    await h.controller.refreshSchedule();
    await vi.advanceTimersByTimeAsync(5_000);
    await vi.waitFor(() => expect(h.logs).toHaveLength(3));
  });

  it("applies an interval change even when a settings save turned the saved running flag off", async () => {
    vi.useFakeTimers();
    const h = setup({ intervalMinSeconds: 100, intervalMaxSeconds: 100 });
    mocks.generate.mockImplementation(async () => reply("x"));
    await h.controller.start();
    await vi.waitFor(() => expect(h.logs).toHaveLength(1));

    // The settings window saves its whole draft, including the flag it loaded before Start.
    Object.assign(h.config.runtime, { enabled: false, intervalMinSeconds: 5, intervalMaxSeconds: 5 });
    await h.controller.refreshSchedule();
    await vi.advanceTimersByTimeAsync(5_000);
    await vi.waitFor(() => expect(h.logs).toHaveLength(2));
  });

  it("runs a cycle right away when start() resumes the loop while a stopped request winds down", async () => {
    const h = setup();
    pendingRequest();
    await h.controller.start();
    await vi.waitFor(() => expect(mocks.generate).toHaveBeenCalledTimes(1));
    mocks.generate.mockImplementation(async () => reply("resumed"));

    void h.controller.stop();
    await h.controller.start();

    await vi.waitFor(() => expect(h.logs.map((entry) => entry.status)).toEqual(["aborted", "success"]));
    expect(h.controller.getStatus()).toMatchObject({ state: "running", cycles: 1 });
  });

  it("logs the raw model output, including reasoning the history copy leaves out", async () => {
    const h = setup();
    mocks.generate.mockResolvedValueOnce({ ...reply("hi"), rawOutput: '<think>plan</think>{"comments":["hi"]}' });
    await h.controller.generateOnce("manual");
    expect(h.logs[0].rawOutput).toBe('<think>plan</think>{"comments":["hi"]}');
  });

  it("shows the learned limit and no stale request size after a request rejected for size", async () => {
    const h = setup();
    mocks.capture.mockResolvedValue(makeSnapshot(1000));
    mocks.generate.mockResolvedValueOnce({ ...reply("first"), requestBytes: 5000 });
    await h.controller.generateOnce("manual");
    expect(h.controller.getStatus().requestBytes).toBe(5000);

    const tooLarge = () =>
      new RequestTooLargeError({ message: "413", requestBytes: 3_000_000, serverBody: "exceeds max_body of 2000000", fromServer: true });
    mocks.generate.mockRejectedValueOnce(tooLarge()).mockRejectedValueOnce(tooLarge());
    await h.controller.generateOnce("manual");

    expect(h.controller.getStatus()).toMatchObject({ requestBytes: undefined, requestLimitBytes: 1_900_000 });
    expect(h.logs.at(-1)).toMatchObject({ status: "error", requestBytes: 3_000_000 });
  });

  it("waits the start delay before the first capture and shows when it is due", async () => {
    vi.useFakeTimers();
    const h = setup({ startDelaySeconds: 5 });
    mocks.generate.mockResolvedValue(reply("hello"));

    await h.controller.start();
    expect(mocks.generate).not.toHaveBeenCalled();
    expect(mocks.capture).not.toHaveBeenCalled();
    const due = Date.parse(h.controller.getStatus().nextCycleAt ?? "");
    expect(due - Date.now()).toBe(5000);
    expect(h.statuses.at(-1)?.nextCycleAt).toBeDefined();

    await vi.advanceTimersByTimeAsync(4999);
    expect(mocks.generate).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(mocks.generate).toHaveBeenCalledTimes(1);
  });

  it("stop() during the start delay cancels the first capture", async () => {
    vi.useFakeTimers();
    const h = setup({ startDelaySeconds: 5 });
    await h.controller.start();
    await h.controller.stop();
    expect(h.controller.getStatus().nextCycleAt).toBeUndefined();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(mocks.generate).not.toHaveBeenCalled();
  });

  it("keeps the start delay when start() resumes while a stopped request winds down", async () => {
    vi.useFakeTimers();
    const h = setup({ startDelaySeconds: 5 });
    pendingRequest();
    await h.controller.start();
    await vi.advanceTimersByTimeAsync(5000);
    expect(mocks.generate).toHaveBeenCalledTimes(1);

    await h.controller.stop();
    mocks.generate.mockResolvedValue(reply("again"));
    await h.controller.start();
    await vi.advanceTimersByTimeAsync(100);
    expect(mocks.generate).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5000);
    expect(mocks.generate).toHaveBeenCalledTimes(2);
  });

  it("summarizes before the window starts over and carries the summary into the next window", async () => {
    const h = setup({ historyRounds: 2, historyMode: "reset-on-limit", historySummaryEnabled: true });
    mocks.generate.mockImplementation(async (input) => reply(`r${input.history?.length}`));
    mocks.summarize.mockResolvedValue({ text: "用户在调试代码", cachedInputTokens: 800, promptTokens: 820 });

    await h.controller.generateOnce("manual");
    expect(mocks.summarize).not.toHaveBeenCalled();
    await h.controller.generateOnce("manual");
    // The next request is the last of this window: the summary runs now, on the same history.
    await vi.waitFor(() => expect(h.logs.some((entry) => entry.reason === "summary")).toBe(true));
    expect(mocks.summarize.mock.calls[0][0].history).toHaveLength(2);
    expect(mocks.summarize.mock.calls[0][2]).toBe(h.config.runtime.historySummaryMaxChars);
    const summaryLog = h.logs.find((entry) => entry.reason === "summary");
    expect(summaryLog).toMatchObject({ status: "success", summary: "用户在调试代码", cachedInputTokens: 800 });

    await h.controller.generateOnce("manual"); // last round of the window, summary not used yet
    expect(mocks.generate.mock.calls[2][0].contextSummary).toBeUndefined();
    const status = await h.controller.generateOnce("manual"); // the new window
    expect(mocks.generate.mock.calls[3][0].history).toHaveLength(0);
    // The round the reset dropped (r2) came after the summary, so its comment is appended.
    expect(mocks.generate.mock.calls[3][0].contextSummary).toBe(`用户在调试代码\n${LATEST_COMMENTS_LABEL} r2`);
    expect(status.contextSummary).toBe(mocks.generate.mock.calls[3][0].contextSummary);
    expect(status.contextSummaryAt).toBeDefined();
  });

  it("does not summarize when the option is off, and clearing history drops the summary", async () => {
    const off = setup({ historyRounds: 1, historyMode: "reset-on-limit" });
    mocks.generate.mockImplementation(async () => reply("x"));
    await off.controller.generateOnce("manual");
    await off.controller.generateOnce("manual");
    expect(mocks.summarize).not.toHaveBeenCalled();

    const h = setup({ historyRounds: 1, historyMode: "reset-on-limit", historySummaryEnabled: true });
    mocks.summarize.mockResolvedValue({ text: "摘要" });
    await h.controller.generateOnce("manual");
    await vi.waitFor(() => expect(h.logs.some((entry) => entry.reason === "summary")).toBe(true));
    await h.controller.generateOnce("manual");
    expect(h.controller.getStatus().contextSummary).toContain("摘要");
    h.controller.clearHistory();
    expect(h.controller.getStatus().contextSummary).toBeUndefined();
  });

  it("logs a failed summary and keeps generating", async () => {
    const h = setup({ historyRounds: 1, historyMode: "reset-on-limit", historySummaryEnabled: true });
    mocks.generate.mockImplementation(async () => reply("x"));
    mocks.summarize.mockRejectedValue(providerError(502));
    await h.controller.generateOnce("manual");
    await vi.waitFor(() => expect(h.logs.some((entry) => entry.reason === "summary")).toBe(true));
    expect(h.logs.find((entry) => entry.reason === "summary")).toMatchObject({ status: "error" });
    expect((await h.controller.generateOnce("manual")).state).toBe("idle");
    expect(mocks.generate.mock.calls[1][0].contextSummary).toBeUndefined();
  });

  it("switches state even when saving the running flag fails", async () => {
    const h = setup();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    h.configStore.update.mockRejectedValue(new Error("EPERM: operation not permitted"));
    mocks.generate.mockImplementation(async () => reply("x"));

    expect((await h.controller.start()).state).toBe("running");
    await vi.waitFor(() => expect(h.logs).toHaveLength(1));
    expect((await h.controller.stop()).state).toBe("paused");
    expect(h.statuses.at(-1)?.state).toBe("paused");
  });
});
