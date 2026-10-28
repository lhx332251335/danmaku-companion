import type {
  AppConfig,
  DanmakuGenerationResult,
  DanmakuInput,
  GenerationLogCompaction,
  ScreenSnapshot,
} from "../../../shared/types";
import { RequestTooLargeError } from "../providers/errors";
import { renderPrompts } from "../providers/messageBuilder";
import type { HistoryWindow } from "./historyWindow";
import {
  LOW_WATER_RATIO,
  UPLOAD_RESET_MIN_BYTES,
  isConnectionReset,
  learnedBodyLimit,
  planCompaction,
} from "./requestBudget";

export interface BudgetSettings {
  historyRounds: number;
  historyMaxImages: number;
  requestBodyLimitBytes: number;
}

export interface BudgetedRequestDeps {
  generate(input: DanmakuInput): Promise<DanmakuGenerationResult>;
  /** Re-encode a screenshot to fit in maxDataUrlBytes; undefined when it cannot. */
  shrinkSnapshot?(snapshot: ScreenSnapshot, maxDataUrlBytes: number): ScreenSnapshot | undefined;
}

/** Filled in while the request runs, so callers can log it on success and on failure. */
export interface BudgetTrace {
  /** Body limit learned from an earlier 413 for this endpoint; updated after a new 413. */
  learnedLimitBytes?: number;
  bodyLimitBytes?: number;
  compaction: GenerationLogCompaction[];
  /** The screenshot that was actually sent (possibly re-encoded smaller). */
  snapshot?: ScreenSnapshot;
  resizedToFit: boolean;
  requestHistoryLength: number;
  historyImagesSent: number;
}

export function createBudgetTrace(learnedLimitBytes?: number): BudgetTrace {
  return {
    learnedLimitBytes,
    compaction: [],
    resizedToFit: false,
    requestHistoryLength: 0,
    historyImagesSent: 0,
  };
}

/**
 * Send one generation request while keeping it under the body budget.
 *
 * Before sending, drops history screenshots in a batch if a limit is exceeded (see planCompaction)
 * and shrinks the current screenshot if it alone is too large. If the server still answers 413
 * (or resets the connection while a large body is uploading), learns its limit, compacts again
 * and retries once.
 */
export async function runBudgetedRequest(
  options: {
    config: AppConfig;
    history: HistoryWindow;
    settings: BudgetSettings;
    input: Omit<DanmakuInput, "history" | "snapshot" | "maxBodyBytes">;
    snapshot?: ScreenSnapshot;
    trace: BudgetTrace;
  },
  deps: BudgetedRequestDeps,
): Promise<DanmakuGenerationResult> {
  const { config, history, settings, input, trace } = options;
  const visionEnabled = config.model.visionEnabled;
  const prompts = renderPrompts(input, config);
  let snapshot = visionEnabled ? options.snapshot : undefined;
  let retryCause: GenerationLogCompaction["trigger"] | undefined;
  // A limit for the retry only; unlike a learned limit it is not kept for later requests.
  let retryLimitBytes = Infinity;

  for (let attempt = 0; ; attempt += 1) {
    const limit = Math.min(
      settings.requestBodyLimitBytes,
      trace.learnedLimitBytes ?? Infinity,
      retryLimitBytes,
    );
    trace.bodyLimitBytes = limit;

    let requestHistory = history.forRequest(settings.historyRounds);
    const plan = planCompaction(
      requestHistory,
      {
        systemText: prompts.systemText,
        userText: prompts.userText,
        snapshot,
        model: config.model.model,
        visionEnabled,
      },
      { maxBodyBytes: limit, maxHistoryImages: settings.historyMaxImages },
    );

    if (plan.dropImageIndexes.length > 0 && plan.reason) {
      const droppedImages = history.dropImages(
        plan.dropImageIndexes.map((index) => requestHistory[index]),
      );
      trace.compaction.push({
        trigger: retryCause ?? "budget",
        reason: plan.reason,
        droppedImages,
      });
      requestHistory = history.forRequest(settings.historyRounds);
    }

    let sentBytesEstimate = plan.estimatedBodyBytes;
    if (plan.overBudget && snapshot && deps.shrinkSnapshot) {
      const otherBytes = plan.estimatedBodyBytes - snapshot.dataUrl.length;
      const shrunk = limit > otherBytes ? deps.shrinkSnapshot(snapshot, limit - otherBytes) : undefined;
      if (shrunk) {
        snapshot = shrunk;
        sentBytesEstimate = otherBytes + shrunk.dataUrl.length;
        trace.resizedToFit = true;
      }
    }

    trace.snapshot = snapshot;
    trace.requestHistoryLength = requestHistory.length;
    trace.historyImagesSent = visionEnabled
      ? requestHistory.filter((round) => round.snapshot).length
      : 0;

    try {
      return await deps.generate({
        ...input,
        history: requestHistory,
        snapshot,
        maxBodyBytes: limit,
      });
    } catch (error) {
      if (input.abortSignal?.aborted) {
        throw error;
      }

      const serverRejectedSize = error instanceof RequestTooLargeError && error.fromServer;
      if (serverRejectedSize) {
        // Learn from every 413, including one on the retry, so later requests start below it.
        trace.learnedLimitBytes = Math.min(
          trace.learnedLimitBytes ?? Infinity,
          learnedBodyLimit(error.requestBytes, error.serverBody ?? ""),
        );
      }
      if (attempt > 0) {
        throw error;
      }

      if (serverRejectedSize) {
        retryCause = "413";
      } else if (error instanceof RequestTooLargeError) {
        // The estimate undercounted; fall back to sending no history screenshots at all.
        const droppedImages = history.dropAllImages();
        if (droppedImages > 0) {
          trace.compaction.push({ trigger: "budget", reason: "bytes", droppedImages });
        }
      } else if (isConnectionReset(error) && sentBytesEstimate >= UPLOAD_RESET_MIN_BYTES) {
        // A server that drops oversized uploads, or just a network blip: retry once with half the
        // body, but keep no limit. The compaction stays in history, so later requests start smaller.
        retryLimitBytes = Math.floor(sentBytesEstimate * LOW_WATER_RATIO);
        retryCause = "reset";
      } else {
        throw error;
      }
    }
  }
}
