import { describe, expect, it, vi } from "vitest";
import {
  ContextSummarizer,
  LATEST_COMMENTS_LABEL,
  type SummaryRun,
} from "../src/electron/main/runtime/contextSummarizer";
import { HistoryWindow, type HistoryWindowSettings } from "../src/electron/main/runtime/historyWindow";
import type { SummaryRequest } from "../src/electron/main/runtime/contextSummarizer";
import type { ContextSummaryResult } from "../src/shared/types";
import { makeConfig } from "./helpers";

const config = makeConfig();
const character = config.character;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function round(window: HistoryWindow, settings: HistoryWindowSettings, text: string): boolean {
  const before = window.compactions;
  const request = window.forRequest(settings.historyRounds);
  window.remember(
    { items: [{ id: text, text, createdAt: "" }], userText: "", assistantText: JSON.stringify({ comments: [text] }) },
    undefined,
    settings,
    request.length,
  );
  return window.compactions !== before;
}

function setup(settings: HistoryWindowSettings) {
  const history = new HistoryWindow();
  const runs: SummaryRun[] = [];
  const pending: Array<ReturnType<typeof deferred<ContextSummaryResult>>> = [];
  const summarize = vi.fn((_request: SummaryRequest) => {
    const next = deferred<ContextSummaryResult>();
    pending.push(next);
    return next.promise;
  });
  const summarizer = new ContextSummarizer(history, { summarize, onSettled: (run) => runs.push(run) });
  const step = (text: string, enabled = true) => {
    const compacted = round(history, settings, text);
    summarizer.afterRound({
      enabled,
      settings,
      compacted,
      comments: [text],
      request: () => ({
        config,
        maxChars: 400,
        input: {
          character,
          maxItems: 3,
          history: history.forRequest(settings.historyRounds),
          contextSummary: history.summary,
        },
      }),
    });
    return compacted;
  };
  return { history, summarizer, summarize, pending, runs, step };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("ContextSummarizer", () => {
  it("summarizes one round before reset-on-limit starts over and carries the summary across", async () => {
    const h = setup({ historyRounds: 3, historyMode: "reset-on-limit", historyIncludeImages: false });
    h.step("a");
    h.step("b");
    expect(h.summarize).not.toHaveBeenCalled();
    h.step("c");
    // The next request is the last one of this window, so the summary starts now.
    expect(h.summarize).toHaveBeenCalledTimes(1);
    expect(h.summarize.mock.calls[0][0].input.history).toHaveLength(3);

    h.pending[0].resolve({ text: "用户在看番，刚聊到天台" });
    await flush();
    expect(h.history.summary).toBeUndefined(); // not before the reset: that would change the prefix

    expect(h.step("d")).toBe(true); // the window starts over
    // "d" was dropped with the window but came after the summary, so its comment is kept.
    expect(h.history.summary).toBe(`用户在看番，刚聊到天台\n${LATEST_COMMENTS_LABEL} d`);
    expect(h.history.forRequest(3)).toHaveLength(0);
    expect(h.runs).toHaveLength(1);
  });

  it("summarizes before batch-sliding halves the window", async () => {
    const h = setup({ historyRounds: 4, historyMode: "batch-sliding", historyIncludeImages: false });
    ["a", "b", "c"].forEach((text) => h.step(text));
    expect(h.summarize).not.toHaveBeenCalled();
    h.step("d");
    expect(h.summarize).toHaveBeenCalledTimes(1);
    h.pending[0].resolve({ text: "summary 1" });
    await flush();
    expect(h.step("e")).toBe(true);
    expect(h.history.summary).toBe("summary 1");
    expect(h.history.length).toBe(2);
  });

  it("applies a summary that arrives after the compaction, and lets the next request wait for it", async () => {
    const h = setup({ historyRounds: 2, historyMode: "reset-on-limit", historyIncludeImages: false });
    h.step("a");
    h.step("b");
    expect(h.summarize).toHaveBeenCalledTimes(1);
    h.step("c"); // compaction while the summary is still running
    expect(h.history.summary).toBeUndefined();

    const waiting = h.summarizer.beforeRequest(new AbortController().signal);
    h.pending[0].resolve({ text: "late summary" });
    await waiting;
    expect(h.history.summary).toBe(`late summary\n${LATEST_COMMENTS_LABEL} c`);
  });

  it("stops waiting after the timeout and still applies the summary when it lands", async () => {
    const h = setup({ historyRounds: 2, historyMode: "reset-on-limit", historyIncludeImages: false });
    h.step("a");
    h.step("b");
    h.step("c");
    await h.summarizer.beforeRequest(new AbortController().signal, 5);
    expect(h.history.summary).toBeUndefined();
    h.pending[0].resolve({ text: "eventually" });
    await flush();
    expect(h.history.summary).toBe(`eventually\n${LATEST_COMMENTS_LABEL} c`);
  });

  it("includes the previous summary in the next summary request, so the timeline accumulates", async () => {
    const h = setup({ historyRounds: 1, historyMode: "reset-on-limit", historyIncludeImages: false });
    h.step("a");
    h.pending[0].resolve({ text: "first" });
    await flush();
    h.step("b"); // starts over, adopts "first"
    h.step("c");
    const last = h.summarize.mock.calls.at(-1)?.[0];
    expect(last?.input.contextSummary).toBe(`first\n${LATEST_COMMENTS_LABEL} b`);
  });

  it("reports failures and continues without a summary", async () => {
    const h = setup({ historyRounds: 2, historyMode: "reset-on-limit", historyIncludeImages: false });
    h.step("a");
    h.step("b");
    h.pending[0].reject(new Error("HTTP 502"));
    await flush();
    expect(h.runs[0].error).toBeInstanceOf(Error);
    expect(h.step("c")).toBe(true);
    expect(h.history.summary).toBeUndefined();
  });

  it("does nothing when disabled, and cancelling discards a running summary", async () => {
    const disabled = setup({ historyRounds: 1, historyMode: "reset-on-limit", historyIncludeImages: false });
    disabled.step("a", false);
    disabled.step("b", false);
    expect(disabled.summarize).not.toHaveBeenCalled();

    const h = setup({ historyRounds: 2, historyMode: "reset-on-limit", historyIncludeImages: false });
    h.step("a");
    h.step("b");
    const signal = h.summarize.mock.calls[0][0].input.abortSignal;
    h.summarizer.cancel();
    expect(signal?.aborted).toBe(true);
    h.pending[0].resolve({ text: "too late" });
    await flush();
    h.step("c");
    expect(h.history.summary).toBeUndefined();
  });

  it("never summarizes in sliding mode", () => {
    const h = setup({ historyRounds: 2, historyMode: "sliding", historyIncludeImages: false });
    ["a", "b", "c", "d"].forEach((text) => h.step(text));
    expect(h.summarize).not.toHaveBeenCalled();
  });
});
