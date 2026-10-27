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
import { learnedBodyLimit, planCompaction } from "./requestBudget";

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
 * and shrinks the current screenshot if it alone is too large. If the server still answers 413,
 * learns its limit, compacts again and retries once.
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

  for (let attempt = 0; ; attempt += 1) {
    const limit = Math.min(settings.requestBodyLimitBytes, trace.learnedLimitBytes ?? Infinity);
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
        trigger: attempt > 0 ? "413" : "budget",
        reason: plan.reason,
        droppedImages,
      });
      requestHistory = history.forRequest(settings.historyRounds);
    }

    if (plan.overBudget && snapshot && deps.shrinkSnapshot) {
      const otherBytes = plan.estimatedBodyBytes - snapshot.dataUrl.length;
      const shrunk = limit > otherBytes ? deps.shrinkSnapshot(snapshot, limit - otherBytes) : undefined;
      if (shrunk) {
        snapshot = shrunk;
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
      if (
        !(error instanceof RequestTooLargeError) ||
        attempt > 0 ||
        input.abortSignal?.aborted
      ) {
        throw error;
      }

      if (error.fromServer) {
        trace.learnedLimitBytes = Math.min(
          trace.learnedLimitBytes ?? Infinity,
          learnedBodyLimit(error.requestBytes, error.serverBody ?? ""),
        );
      } else {
        // The estimate undercounted; fall back to sending no history screenshots at all.
        const droppedImages = history.dropAllImages();
        if (droppedImages > 0) {
          trace.compaction.push({ trigger: "budget", reason: "bytes", droppedImages });
        }
      }
    }
  }
}
