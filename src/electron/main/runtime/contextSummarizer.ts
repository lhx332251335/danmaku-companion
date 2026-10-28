import type { AppConfig, ContextSummaryResult, DanmakuInput } from "../../../shared/types";
import type { HistoryWindow, HistoryWindowSettings } from "./historyWindow";

/** A summary request, built from the history and settings at the time it starts. */
export interface SummaryRequest {
  input: DanmakuInput;
  config: AppConfig;
  maxChars: number;
}

export interface SummaryRun {
  startedAt: string;
  durationMs: number;
  request: SummaryRequest;
  result?: ContextSummaryResult;
  error?: unknown;
  aborted: boolean;
}

export interface ContextSummarizerDeps {
  summarize(request: SummaryRequest): Promise<ContextSummaryResult>;
  /** Called once per finished, failed or aborted summary request. */
  onSettled(run: SummaryRun): void;
}

/** How long a request after a compaction waits for a summary that is still being written. */
export const SUMMARY_WAIT_MS = 20_000;

/** Introduces the comments of the round a reset dropped after the summary was written. */
export const LATEST_COMMENTS_LABEL = "Comments sent after this summary was written:";

/**
 * Keeps continuity across the history window's compactions (reset-on-limit starting over,
 * batch-sliding halving). One round before a compaction it summarizes the window in a
 * background request that shares the generation requests' prefix, so the server only has to
 * prefill the last reply and the instruction. The summary goes into the system prompt when the
 * compaction happens, which already changes the prefix, so it costs no extra cache miss.
 */
export class ContextSummarizer {
  private task: { abort: AbortController; done: Promise<void> } | undefined;
  /** Finished before the compaction it was written for. */
  private ready: string | undefined;
  /** The compaction already happened while the summary was still being written. */
  private applyWhenReady = false;
  /** Comments the compaction dropped that the summary does not cover yet. */
  private droppedComments: string[] = [];

  constructor(
    private readonly history: HistoryWindow,
    private readonly deps: ContextSummarizerDeps,
  ) {}

  get running(): boolean {
    return this.task !== undefined;
  }

  /**
   * Call after each stored round. `compacted` says whether that round made the window start over
   * or halve; `comments` are the round's comments; `request` builds the summary request from the
   * current history.
   */
  afterRound(options: {
    enabled: boolean;
    settings: HistoryWindowSettings;
    compacted: boolean;
    comments: string[];
    request: () => SummaryRequest;
  }): void {
    if (!options.enabled) {
      this.cancel();
      this.history.setSummary(undefined);
      return;
    }

    if (options.compacted) {
      // The summary was written a round ahead. When the window started over, that last round is
      // gone too, so its comments are added after the summary to keep the timeline complete.
      this.adopt(this.history.length === 0 ? options.comments : []);
    }

    if (
      !this.task &&
      this.ready === undefined &&
      !this.applyWhenReady &&
      this.history.willCompactNextRound(options.settings)
    ) {
      this.start(options.request());
    }
  }

  /** Before a request: wait (bounded) for a summary the last compaction is still waiting for. */
  async beforeRequest(signal: AbortSignal, waitMs = SUMMARY_WAIT_MS): Promise<void> {
    if (!this.applyWhenReady || !this.task) {
      return;
    }

    let timer: NodeJS.Timeout | undefined;
    let onAbort: (() => void) | undefined;
    await Promise.race([
      this.task.done,
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, waitMs);
        onAbort = resolve;
        signal.addEventListener("abort", onAbort, { once: true });
      }),
    ]);
    clearTimeout(timer);
    if (onAbort) {
      signal.removeEventListener("abort", onAbort);
    }
  }

  /** Abort a running summary; with `keepReady` a finished one is still applied later. */
  cancel(keepReady = false): void {
    this.task?.abort.abort();
    this.task = undefined;
    this.applyWhenReady = false;
    this.droppedComments = [];
    if (!keepReady) {
      this.ready = undefined;
    }
  }

  private adopt(droppedComments: string[]): void {
    if (this.ready !== undefined) {
      this.droppedComments = droppedComments;
      this.apply(this.ready);
      this.ready = undefined;
    } else if (this.task) {
      this.droppedComments = droppedComments;
      this.applyWhenReady = true;
    }
  }

  private apply(summary: string): void {
    const comments = this.droppedComments.map((comment) => comment.trim()).filter(Boolean);
    this.droppedComments = [];
    this.history.setSummary(
      comments.length > 0 ? `${summary.trim()}\n${LATEST_COMMENTS_LABEL} ${comments.join(" / ")}` : summary,
    );
  }

  private start(base: SummaryRequest): void {
    const abort = new AbortController();
    const startedAt = new Date();
    const request: SummaryRequest = { ...base, input: { ...base.input, abortSignal: abort.signal } };
    const task = { abort, done: Promise.resolve() };
    task.done = this.deps
      .summarize(request)
      .then(
        (result) => {
          if (this.task !== task) {
            return;
          }
          if (this.applyWhenReady) {
            this.apply(result.text);
            this.applyWhenReady = false;
          } else {
            this.ready = result.text;
          }
          this.settle(task, { startedAt, request, result, aborted: false });
        },
        (error: unknown) => {
          const current = this.task === task;
          if (current) {
            this.applyWhenReady = false;
            this.droppedComments = [];
          }
          this.settle(task, { startedAt, request, error, aborted: abort.signal.aborted || !current });
        },
      );
    this.task = task;
  }

  private settle(
    task: { abort: AbortController },
    run: Omit<SummaryRun, "durationMs" | "startedAt"> & { startedAt: Date },
  ): void {
    if (this.task === task) {
      this.task = undefined;
    }
    this.deps.onSettled({
      ...run,
      startedAt: run.startedAt.toISOString(),
      durationMs: Date.now() - run.startedAt.getTime(),
    });
  }
}
