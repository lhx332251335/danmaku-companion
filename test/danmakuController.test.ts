import type { BrowserWindow } from "electron";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ConfigStore } from "../src/electron/main/configStore";
import { DanmakuController } from "../src/electron/main/danmakuController";
import type { GenerationLogStore } from "../src/electron/main/generationLogStore";
import type {
  AppConfig,
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
  },
}));

const controllers: DanmakuController[] = [];

afterEach(() => {
  controllers.splice(0).forEach((controller) => controller.shutdown());
  mocks.generate.mockReset();
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
