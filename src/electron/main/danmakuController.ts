import type { BrowserWindow } from "electron";
import type {
  AppConfig,
  GenerationLogEntry,
  DanmakuItem,
  RuntimeStatus,
  ScreenSnapshot,
} from "../../shared/types";
import { capturePrimaryScreen, shrinkSnapshotToFit } from "./capture/screenCapture";
import { ConfigStore } from "./configStore";
import { GenerationLogStore } from "./generationLogStore";
import { endpoint } from "./providers/endpoints";
import { OpenAICompatibleProvider } from "./providers/openAiCompatibleProvider";
import { createBudgetTrace, runBudgetedRequest, type BudgetTrace } from "./runtime/budgetedRequest";
import { HistoryWindow } from "./runtime/historyWindow";
import {
  normalizeRuntimeSettings,
  randomBetween,
  randomReleaseWindowSeconds,
  releaseDelays,
  type NormalizedRuntimeSettings,
} from "./runtime/runtimeSettings";

type OverlayGetter = () => BrowserWindow | undefined;

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
  private timer: NodeJS.Timeout | undefined;
  private readonly releaseTimers = new Set<NodeJS.Timeout>();
  private readonly history = new HistoryWindow();
  /** Body limits learned from HTTP 413 responses, per chat-completions endpoint. */
  private readonly learnedBodyLimits = new Map<string, number>();
  private activeGenerationAbort: AbortController | undefined;
  private busy = false;
  private running = false;
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

  async start(): Promise<RuntimeStatus> {
    if (this.running) {
      return this.status;
    }

    this.shuttingDown = false;
    await this.configStore.update({ runtime: { enabled: true } });
    this.running = true;
    this.status = { ...this.status, state: "running", lastError: undefined };
    this.broadcastStatus(this.status);
    void this.generateOnce("timer");

    return this.status;
  }

  shutdown(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    this.clearPendingItems();
    this.running = false;
    this.shuttingDown = true;
    this.activeGenerationAbort?.abort();
  }

  async stop(): Promise<RuntimeStatus> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    this.clearPendingItems();
    this.running = false;

    await this.configStore.update({ runtime: { enabled: false } });
    this.status = { ...this.status, state: "paused" };
    this.broadcastStatus(this.status);
    return this.status;
  }

  async refreshSchedule(): Promise<void> {
    const config = await this.configStore.get();
    if (!this.running || !config.runtime.enabled) {
      return;
    }

    this.scheduleNextCycle(config);
  }

  async generateOnce(reason: "manual" | "timer"): Promise<RuntimeStatus> {
    if (this.busy) {
      if (reason === "timer" && this.running) {
        this.scheduleNextCycle(await this.configStore.get());
      }
      return this.status;
    }

    this.busy = true;
    const startedAt = performance.now();
    const startedAtIso = new Date().toISOString();
    const generationAbort = new AbortController();
    this.activeGenerationAbort = generationAbort;
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

      if (!generationAbort.signal.aborted && !this.shuttingDown && (reason === "manual" || this.running)) {
        this.history.remember(result, sentSnapshot, runtime, trace.requestHistoryLength);
        this.scheduleItems(result.items, releaseWindowSeconds);
      }
      const completedAt = new Date().toISOString();
      const durationMs = Math.round(performance.now() - startedAt);
      logEntry = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        cycle: this.status.cycles + 1,
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
        rawOutput: result.assistantText,
      };
      this.status = {
        state: this.running ? "running" : reason === "timer" ? "paused" : "idle",
        cycles: this.status.cycles + 1,
        lastGeneratedAt: completedAt,
        lastError: undefined,
        providerLatencyMs: durationMs,
        cachedInputTokens: result.cachedInputTokens,
        promptTokens: result.promptTokens,
        requestBytes: result.requestBytes,
        historyImages: trace.historyImagesSent,
      };
    } catch (error) {
      const aborted = generationAbort.signal.aborted || this.shuttingDown;
      const completedAt = new Date().toISOString();
      const durationMs = Math.round(performance.now() - startedAt);
      logEntry = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        cycle: this.status.cycles + 1,
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
        screen: screenLogInfo(
          Boolean(config?.model.visionEnabled),
          budgetTrace?.snapshot ?? snapshot,
          captureError,
          budgetTrace?.resizedToFit,
        ),
        comments: [],
        error: aborted ? undefined : errorMessage(error),
      };
      if (aborted) {
        this.status = {
          ...this.status,
          state: "paused",
          lastError: undefined,
          cachedInputTokens: undefined,
          promptTokens: undefined,
        };
      } else {
        this.status = {
          ...this.status,
          state: this.running ? "running" : "error",
          lastError: errorMessage(error),
          cachedInputTokens: undefined,
          promptTokens: undefined,
        };
      }
    } finally {
      if (logEntry && !this.shuttingDown) {
        await this.appendGenerationLog(logEntry, config);
      }
      this.busy = false;
      if (this.activeGenerationAbort === generationAbort) {
        this.activeGenerationAbort = undefined;
      }
      if (reason === "timer" && this.running && !this.shuttingDown) {
        this.scheduleNextCycle(config ?? (await this.configStore.get()));
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
    this.history.reset();
    this.status = { ...this.status, cachedInputTokens: undefined, promptTokens: undefined };
    this.broadcastStatus(this.status);
  }

  pushSystemMessage(text: string): void {
    this.pushItems([
      {
        id: `${Date.now()}-system`,
        text,
        createdAt: new Date().toISOString(),
        source: "system",
      },
    ]);
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

  private scheduleNextCycle(config: AppConfig): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }

    if (!this.running) {
      return;
    }

    const runtime = normalizeRuntimeSettings(config);
    const delayMs = Math.round(
      randomBetween(runtime.intervalMinSeconds, runtime.intervalMaxSeconds) * 1000,
    );
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.generateOnce("timer");
    }, delayMs);
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
    if (items.length === 0) {
      return;
    }

    const overlay = this.getOverlay();
    if (!overlay || overlay.isDestroyed()) {
      return;
    }

    overlay.webContents.send("danmaku:items", items);
  }
}
