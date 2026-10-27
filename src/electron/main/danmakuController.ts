import type { BrowserWindow } from "electron";
import type {
  AppConfig,
  GenerationLogEntry,
  DanmakuItem,
  HistoryRecovery,
  RuntimeState,
  RuntimeStatus,
  ScreenSnapshot,
} from "../../shared/types";
import { capturePrimaryScreen, shrinkSnapshotToFit } from "./capture/screenCapture";
import { ConfigStore } from "./configStore";
import { GenerationLogStore } from "./generationLogStore";
import { endpoint } from "./providers/endpoints";
import { RequestTooLargeError } from "./providers/errors";
import { OpenAICompatibleProvider } from "./providers/openAiCompatibleProvider";
import { createBudgetTrace, runBudgetedRequest, type BudgetTrace } from "./runtime/budgetedRequest";
import { isRepeatingRequestError } from "./runtime/failurePolicy";
import { HistoryWindow } from "./runtime/historyWindow";
import {
  cycleDelayMs,
  normalizeRuntimeSettings,
  randomReleaseWindowSeconds,
  releaseDelays,
  rescheduledDelayMs,
  type ArmedCycle,
  type CycleInterval,
  type NormalizedRuntimeSettings,
} from "./runtime/runtimeSettings";

type OverlayGetter = () => BrowserWindow | undefined;
type GenerationReason = "manual" | "timer";

const statusIdle: RuntimeStatus = {
  state: "idle",
  cycles: 0,
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function budgetLogInfo(trace: BudgetTrace | undefined): Partial<GenerationLogEntry> {
  if (!trace) {
    return {};
  }

  return {
    bodyLimitBytes: trace.bodyLimitBytes,
    historyImagesSent: trace.historyImagesSent,
    compaction: trace.compaction.length > 0 ? trace.compaction : undefined,
  };
}

function screenLogInfo(
  visionEnabled: boolean,
  snapshot: ScreenSnapshot | undefined,
  captureError: string | undefined,
  resizedToFit = false,
): GenerationLogEntry["screen"] {
  return {
    enabled: visionEnabled,
    captured: Boolean(snapshot),
    width: snapshot?.width,
    height: snapshot?.height,
    format: snapshot?.format,
    imageBytes: snapshot?.imageBytes,
    dataUrlBytes: snapshot?.dataUrlBytes,
    jpegQuality: snapshot?.jpegQuality,
    sourceName: snapshot?.sourceName,
    capturedAt: snapshot?.capturedAt,
    resizedToFit: resizedToFit || undefined,
    error: captureError,
  };
}

export class DanmakuController {
  private cycleTimer: { handle: NodeJS.Timeout; armed: ArmedCycle } | undefined;
  private readonly releaseTimers = new Set<NodeJS.Timeout>();
  private readonly history = new HistoryWindow();
  /** Body limits learned from HTTP 413 responses, per chat-completions endpoint. */
  private readonly learnedBodyLimits = new Map<string, number>();
  private activeGeneration: { abort: AbortController; reason: GenerationReason } | undefined;
  // Bumped on every clear, so a generation that was in flight cannot bring back what was cleared.
  private historyEpoch = 0;
  private overlayEpoch = 0;
  private attempts = 0;
  private systemMessageCount = 0;
  private busy = false;
  private running = false;
  /** Paused by the user, as opposed to never started. */
  private stopped = false;
  private shuttingDown = false;
  private status: RuntimeStatus = statusIdle;
  private readonly provider = new OpenAICompatibleProvider();

  constructor(
    private readonly configStore: ConfigStore,
    private readonly logStore: GenerationLogStore,
    private readonly getOverlay: OverlayGetter,
    private readonly broadcastStatus: (status: RuntimeStatus) => void,
  ) {}

  getStatus(): RuntimeStatus {
    return this.status;
  }

  // start() and stop() switch state before persisting it, so a failed or slow config write
  // cannot leave the UI out of step with the loop.
  async start(): Promise<RuntimeStatus> {
    if (this.running || this.shuttingDown) {
      return this.status;
    }

    this.running = true;
    this.stopped = false;
    this.status = { ...this.status, state: "running", lastError: undefined };
    this.broadcastStatus(this.status);
    void this.generateOnce("timer");
    await this.persistEnabled(true);

    return this.status;
  }

  shutdown(): void {
    this.clearCycleTimer();
    this.clearPendingItems();
    this.running = false;
    this.shuttingDown = true;
    this.activeGeneration?.abort.abort();
  }

  async stop(): Promise<RuntimeStatus> {
    this.clearCycleTimer();
    this.clearPendingItems();
    this.running = false;
    this.stopped = true;
    // A manual generation is still shown while paused; a timer one is not wanted any more.
    if (this.activeGeneration?.reason === "timer") {
      this.activeGeneration.abort.abort();
    }

    this.status = { ...this.status, state: "paused" };
    this.broadcastStatus(this.status);
    await this.persistEnabled(false);
    return this.status;
  }

  async refreshSchedule(): Promise<void> {
    const config = await this.configStore.get();
    // `running` is the loop's state; the saved flag only means "start on launch" and a settings
    // save can carry a stale copy of it. Without an armed timer a timer generation is in flight,
    // and it re-reads the config when done.
    if (!this.running || !this.cycleTimer) {
      return;
    }

    const interval = normalizeRuntimeSettings(config);
    const delayMs = rescheduledDelayMs(this.cycleTimer.armed, interval, Date.now());
    if (delayMs !== undefined) {
      this.armCycleTimer(interval, delayMs);
    }
  }

  async generateOnce(reason: GenerationReason): Promise<RuntimeStatus> {
    if (this.busy) {
      if (reason === "timer" && this.running) {
        this.scheduleNextCycle(await this.configStore.get());
      }
      return this.status;
    }

    this.busy = true;
    this.attempts += 1;
    const attempt = this.attempts;
    const historyEpoch = this.historyEpoch;
    const overlayEpoch = this.overlayEpoch;
    const startedAt = performance.now();
    const startedAtIso = new Date().toISOString();
    const generationAbort = new AbortController();
    this.activeGeneration = { abort: generationAbort, reason };
    let config: AppConfig | undefined;
    let logEntry: GenerationLogEntry | undefined;
    let runtime: NormalizedRuntimeSettings | undefined;
    let requestedCount = 0;
    let snapshot: ScreenSnapshot | undefined;
    let captureError: string | undefined;
    let budgetTrace: BudgetTrace | undefined;

    try {
      config = await this.configStore.get();
      runtime = normalizeRuntimeSettings(config);
      requestedCount = runtime.itemsPerCycle;
      if (!runtime.historyIncludeImages || !config.model.visionEnabled) {
        // Screenshots stored before the setting changed would otherwise be sent (and held) for
        // as long as their rounds stay in the window.
        this.history.dropAllImages();
      }
      if (config.model.visionEnabled) {
        try {
          snapshot = await capturePrimaryScreen(runtime.captureMaxEdgePixels, {
            format: runtime.captureImageFormat,
            jpegQuality: runtime.captureJpegQuality,
          });
        } catch (error) {
          captureError = errorMessage(error);
          console.warn(
            "Screen capture failed; generating text-only danmaku.",
            captureError,
          );
        }
      }

      const activeConfig = config;
      const endpointKey = endpoint(activeConfig.model.baseUrl, "chat/completions");
      const trace = createBudgetTrace(this.learnedBodyLimits.get(endpointKey));
      budgetTrace = trace;
      const result = await runBudgetedRequest(
        {
          config: activeConfig,
          history: this.history,
          settings: runtime,
          input: {
            character: activeConfig.character,
            maxItems: requestedCount,
            abortSignal: generationAbort.signal,
          },
          snapshot,
          trace,
        },
        {
          generate: (input) => this.provider.generateDanmaku(input, activeConfig),
          shrinkSnapshot: shrinkSnapshotToFit,
        },
      ).finally(() => {
        if (trace.learnedLimitBytes !== undefined) {
          this.learnedBodyLimits.set(endpointKey, trace.learnedLimitBytes);
        }
      });
      const sentSnapshot = trace.snapshot;

      const releaseWindowSeconds = randomReleaseWindowSeconds(
        runtime.releaseWindowMinSeconds,
        runtime.releaseWindowMaxSeconds,
      );

      generationAbort.signal.throwIfAborted();
      if (historyEpoch === this.historyEpoch) {
        this.history.remember(result, sentSnapshot, runtime, trace.requestHistoryLength);
      }
      if (overlayEpoch === this.overlayEpoch) {
        this.scheduleItems(result.items, releaseWindowSeconds);
      }
      const completedAt = new Date().toISOString();
      const durationMs = Math.round(performance.now() - startedAt);
      logEntry = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        cycle: attempt,
        reason,
        status: "success",
        startedAt: startedAtIso,
        completedAt,
        durationMs,
        model: config.model.model,
        requestedCount,
        generatedCount: result.items.length,
        releaseWindowSeconds: Math.round(releaseWindowSeconds * 100) / 100,
        historyRoundsUsed: trace.requestHistoryLength,
        historyMode: runtime.historyMode,
        historyImagesIncluded: runtime.historyIncludeImages,
        cachedInputTokens: result.cachedInputTokens,
        promptTokens: result.promptTokens,
        completionTokens: result.completionTokens,
        promptMs: result.promptMs,
        requestBytes: result.requestBytes,
        ...budgetLogInfo(trace),
        screen: screenLogInfo(
          config.model.visionEnabled,
          sentSnapshot ?? snapshot,
          captureError,
          trace.resizedToFit,
        ),
        comments: result.items.map((item) => item.text),
        rawOutput: result.rawOutput ?? result.assistantText,
        finishReason: result.finishReason,
      };
      this.status = {
        state: this.restingState(),
        cycles: this.status.cycles + 1,
        lastGeneratedAt: completedAt,
        lastError: undefined,
        providerLatencyMs: durationMs,
        cachedInputTokens: result.cachedInputTokens,
        promptTokens: result.promptTokens,
        requestBytes: result.requestBytes,
        requestLimitBytes: trace.bodyLimitBytes,
        historyImages: trace.historyImagesSent,
      };
    } catch (error) {
      const aborted = generationAbort.signal.aborted || this.shuttingDown;
      const historyRecovery =
        !aborted && historyEpoch === this.historyEpoch
          ? this.recoverHistoryAfter(error)
          : undefined;
      const completedAt = new Date().toISOString();
      const durationMs = Math.round(performance.now() - startedAt);
      logEntry = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        cycle: attempt,
        reason,
        status: aborted ? "aborted" : "error",
        startedAt: startedAtIso,
        completedAt,
        durationMs,
        model: config?.model.model,
        requestedCount: requestedCount || undefined,
        historyRoundsUsed: budgetTrace?.requestHistoryLength ?? 0,
        historyMode: runtime?.historyMode,
        historyImagesIncluded: runtime?.historyIncludeImages,
        ...budgetLogInfo(budgetTrace),
        historyRecovery,
        screen: screenLogInfo(
          Boolean(config?.model.visionEnabled),
          budgetTrace?.snapshot ?? snapshot,
          captureError,
          budgetTrace?.resizedToFit,
        ),
        comments: [],
        requestBytes: error instanceof RequestTooLargeError ? error.requestBytes : undefined,
        error: aborted ? undefined : errorMessage(error),
      };
      if (aborted) {
        this.status = {
          ...this.status,
          state: this.restingState(),
          lastError: undefined,
          ...this.clearedRequestStats(budgetTrace),
        };
      } else {
        this.status = {
          ...this.status,
          state: this.running ? "running" : "error",
          lastError: errorMessage(error),
          ...this.clearedRequestStats(budgetTrace),
        };
      }
    } finally {
      if (logEntry && !this.shuttingDown) {
        await this.appendGenerationLog(logEntry, config);
      }
      this.busy = false;
      if (this.activeGeneration?.abort === generationAbort) {
        this.activeGeneration = undefined;
      }
      if (reason === "timer" && this.running && !this.shuttingDown) {
        // Re-read: the interval may have been changed while the request ran. A run that stop()
        // aborted only gets here if start() resumed the loop meanwhile, and that start's own
        // first cycle was skipped as busy, so run it now instead of a whole interval later.
        this.scheduleNextCycle(await this.configStore.get(), generationAbort.signal.aborted);
      }
      if (!this.shuttingDown) {
        this.broadcastStatus(this.status);
      }
    }

    return this.status;
  }

  clearPendingItems(): void {
    this.releaseTimers.forEach((timer) => clearTimeout(timer));
    this.releaseTimers.clear();
  }

  clearHistory(): void {
    this.historyEpoch += 1;
    this.history.reset();
    this.status = {
      ...this.status,
      cachedInputTokens: undefined,
      promptTokens: undefined,
      historyImages: undefined,
    };
    this.broadcastStatus(this.status);
  }

  /** Clear the overlay, the comments still waiting to be released, and history. */
  clearOverlay(): void {
    this.overlayEpoch += 1;
    this.clearPendingItems();
    this.clearHistory();
    this.sendToOverlay("overlay:clear");
  }

  pushSystemMessage(text: string): void {
    this.pushItems([
      {
        id: `${Date.now()}-system-${(this.systemMessageCount += 1)}`,
        text,
        createdAt: new Date().toISOString(),
        source: "system",
      },
    ]);
  }

  /** Status fields of a request that did not complete: no usage, and the limit now in effect. */
  private clearedRequestStats(trace: BudgetTrace | undefined): Partial<RuntimeStatus> {
    return {
      cachedInputTokens: undefined,
      promptTokens: undefined,
      requestBytes: undefined,
      historyImages: undefined,
      requestLimitBytes:
        trace?.bodyLimitBytes !== undefined
          ? Math.min(trace.bodyLimitBytes, trace.learnedLimitBytes ?? Infinity)
          : this.status.requestLimitBytes,
    };
  }

  private restingState(): RuntimeState {
    return this.running ? "running" : this.stopped ? "paused" : "idle";
  }

  private recoverHistoryAfter(error: unknown): HistoryRecovery | undefined {
    return isRepeatingRequestError(error) ? this.history.shrinkAfterRejection() : undefined;
  }

  private async persistEnabled(enabled: boolean): Promise<void> {
    try {
      await this.configStore.update({ runtime: { enabled } });
    } catch (error) {
      console.warn("Failed to save the running state.", errorMessage(error));
    }
  }

  private async appendGenerationLog(
    entry: GenerationLogEntry,
    config: AppConfig | undefined,
  ): Promise<void> {
    try {
      const limit = config
        ? normalizeRuntimeSettings(config).generationLogLimit
        : undefined;
      await this.logStore.append(entry, limit);
    } catch (error) {
      console.warn("Failed to write generation log.", errorMessage(error));
    }
  }

  private scheduleNextCycle(config: AppConfig, immediately = false): void {
    const interval = normalizeRuntimeSettings(config);
    this.armCycleTimer(interval, immediately ? 0 : cycleDelayMs(interval));
  }

  private armCycleTimer(interval: CycleInterval, delayMs: number): void {
    this.clearCycleTimer();
    if (!this.running) {
      return;
    }

    const handle = setTimeout(() => {
      this.cycleTimer = undefined;
      void this.generateOnce("timer");
    }, delayMs);
    this.cycleTimer = {
      handle,
      armed: {
        intervalMinSeconds: interval.intervalMinSeconds,
        intervalMaxSeconds: interval.intervalMaxSeconds,
        dueAt: Date.now() + delayMs,
      },
    };
  }

  private clearCycleTimer(): void {
    if (this.cycleTimer) {
      clearTimeout(this.cycleTimer.handle);
      this.cycleTimer = undefined;
    }
  }

  private scheduleItems(items: DanmakuItem[], releaseWindowSeconds: number): void {
    releaseDelays(items.length, releaseWindowSeconds).forEach((delayMs, index) => {
      const item = items[index];
      const timer = setTimeout(() => {
        this.releaseTimers.delete(timer);
        this.pushItems([item]);
      }, delayMs);
      this.releaseTimers.add(timer);
    });
  }

  private pushItems(items: DanmakuItem[]): void {
    if (items.length > 0) {
      this.sendToOverlay("danmaku:items", items);
    }
  }

  private sendToOverlay(channel: string, ...args: unknown[]): void {
    const overlay = this.getOverlay();
    if (overlay && !overlay.isDestroyed()) {
      overlay.webContents.send(channel, ...args);
    }
  }
}
