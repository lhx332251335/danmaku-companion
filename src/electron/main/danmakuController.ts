import type { BrowserWindow } from "electron";
import type {
  AppConfig,
  DanmakuGenerationResult,
  DanmakuHistoryRound,
  GenerationLogEntry,
  HistoryMode,
  DanmakuItem,
  RuntimeStatus,
  ScreenSnapshot,
} from "../../shared/types";
import { capturePrimaryScreen } from "./capture/screenCapture";
import { ConfigStore } from "./configStore";
import { GenerationLogStore } from "./generationLogStore";
import { OpenAICompatibleProvider } from "./providers/openAiCompatibleProvider";

type OverlayGetter = () => BrowserWindow | undefined;

const statusIdle: RuntimeStatus = {
  state: "idle",
  cycles: 0,
};
const INTERVAL_MIN_SECONDS = 5;
const INTERVAL_MAX_SECONDS = 1800;
const ITEMS_MIN = 1;
const ITEMS_MAX = 12;
const RELEASE_WINDOW_MIN_SECONDS = 0;
const RELEASE_WINDOW_MAX_SECONDS = 60;
const CAPTURE_MAX_EDGE_MIN_PIXELS = 480;
const CAPTURE_MAX_EDGE_MAX_PIXELS = 2160;
const HISTORY_ROUNDS_MIN = 0;
const HISTORY_ROUNDS_MAX = 50;
const GENERATION_LOG_LIMIT_MIN = 10;
const GENERATION_LOG_LIMIT_MAX = 2000;

interface NormalizedRuntimeSettings {
  intervalMinSeconds: number;
  intervalMaxSeconds: number;
  itemsPerCycle: number;
  releaseWindowMinSeconds: number;
  releaseWindowMaxSeconds: number;
  captureMaxEdgePixels: number;
  historyRounds: number;
  historyMode: HistoryMode;
  historyIncludeImages: boolean;
  generationLogLimit: number;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }

  return Math.min(max, Math.max(min, value));
}

function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function normalizeRuntimeSettings(config: AppConfig): NormalizedRuntimeSettings {
  const runtime = config.runtime;
  const rawIntervalMin = runtime.intervalMinSeconds ?? runtime.intervalSeconds;
  const rawIntervalMax = runtime.intervalMaxSeconds ?? runtime.intervalSeconds;
  const intervalMin = clamp(
    Math.min(rawIntervalMin, rawIntervalMax),
    INTERVAL_MIN_SECONDS,
    INTERVAL_MAX_SECONDS,
  );
  const intervalMax = clamp(
    Math.max(rawIntervalMin, rawIntervalMax),
    INTERVAL_MIN_SECONDS,
    INTERVAL_MAX_SECONDS,
  );

  const rawItemsPerCycle =
    runtime.itemsPerCycle ?? runtime.itemsMaxPerCycle ?? runtime.itemsMinPerCycle;
  const itemsPerCycle = Math.round(
    clamp(rawItemsPerCycle, ITEMS_MIN, ITEMS_MAX),
  );
  const rawReleaseWindowMin =
    runtime.releaseWindowMinSeconds ?? runtime.releaseWindowSeconds;
  const rawReleaseWindowMax =
    runtime.releaseWindowMaxSeconds ?? runtime.releaseWindowSeconds;
  const releaseWindowMinSeconds = clamp(
    Math.min(rawReleaseWindowMin, rawReleaseWindowMax),
    RELEASE_WINDOW_MIN_SECONDS,
    RELEASE_WINDOW_MAX_SECONDS,
  );
  const releaseWindowMaxSeconds = clamp(
    Math.max(rawReleaseWindowMin, rawReleaseWindowMax),
    RELEASE_WINDOW_MIN_SECONDS,
    RELEASE_WINDOW_MAX_SECONDS,
  );

  return {
    intervalMinSeconds: intervalMin,
    intervalMaxSeconds: intervalMax,
    itemsPerCycle,
    releaseWindowMinSeconds,
    releaseWindowMaxSeconds,
    captureMaxEdgePixels: Math.round(
      clamp(
        runtime.captureMaxEdgePixels,
        CAPTURE_MAX_EDGE_MIN_PIXELS,
        CAPTURE_MAX_EDGE_MAX_PIXELS,
      ),
    ),
    historyRounds: Math.round(
      clamp(runtime.historyRounds, HISTORY_ROUNDS_MIN, HISTORY_ROUNDS_MAX),
    ),
    historyMode: runtime.historyMode ?? "reset-on-limit",
    historyIncludeImages: Boolean(runtime.historyIncludeImages),
    generationLogLimit: Math.round(
      clamp(
        runtime.generationLogLimit,
        GENERATION_LOG_LIMIT_MIN,
        GENERATION_LOG_LIMIT_MAX,
      ),
    ),
  };
}

function releaseDelays(count: number, releaseWindowSeconds: number): number[] {
  if (count <= 0) {
    return [];
  }

  const releaseWindowMs = releaseWindowSeconds * 1000;
  if (releaseWindowMs <= 0 || count === 1) {
    return Array.from({ length: count }, () =>
      Math.round(randomBetween(0, releaseWindowMs)),
    );
  }

  const segmentMs = releaseWindowMs / count;
  return Array.from({ length: count }, (_item, index) => {
    const segmentStart = index * segmentMs;
    return Math.round(
      Math.min(releaseWindowMs, segmentStart + randomBetween(0, segmentMs)),
    );
  });
}

function randomReleaseWindowSeconds(minSeconds: number, maxSeconds: number): number {
  if (maxSeconds <= 0) {
    return 0;
  }

  return randomBetween(minSeconds, maxSeconds);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function screenLogInfo(
  visionEnabled: boolean,
  snapshot: ScreenSnapshot | undefined,
  captureError: string | undefined,
): GenerationLogEntry["screen"] {
  return {
    enabled: visionEnabled,
    captured: Boolean(snapshot),
    width: snapshot?.width,
    height: snapshot?.height,
    sourceName: snapshot?.sourceName,
    capturedAt: snapshot?.capturedAt,
    error: captureError,
  };
}

export class DanmakuController {
  private timer: NodeJS.Timeout | undefined;
  private readonly releaseTimers = new Set<NodeJS.Timeout>();
  private readonly history: DanmakuHistoryRound[] = [];
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
    let requestHistoryLength = 0;
    let snapshot: ScreenSnapshot | undefined;
    let captureError: string | undefined;

    try {
      config = await this.configStore.get();
      runtime = normalizeRuntimeSettings(config);
      requestedCount = runtime.itemsPerCycle;
      const requestHistory = this.historyForRequest(runtime.historyRounds);
      requestHistoryLength = requestHistory.length;
      if (config.model.visionEnabled) {
        try {
          snapshot = await capturePrimaryScreen(runtime.captureMaxEdgePixels);
        } catch (error) {
          captureError = errorMessage(error);
          console.warn(
            "Screen capture failed; generating text-only danmaku.",
            captureError,
          );
        }
      }

      const result = await this.provider.generateDanmaku(
        {
          snapshot,
          character: config.character,
          maxItems: requestedCount,
          history: requestHistory,
          abortSignal: generationAbort.signal,
        },
        config,
      );

      const releaseWindowSeconds = randomReleaseWindowSeconds(
        runtime.releaseWindowMinSeconds,
        runtime.releaseWindowMaxSeconds,
      );

      if (!generationAbort.signal.aborted && !this.shuttingDown && (reason === "manual" || this.running)) {
        this.rememberHistory(result, snapshot, runtime, requestHistory.length);
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
        historyRoundsUsed: requestHistory.length,
        historyMode: runtime.historyMode,
        historyImagesIncluded: runtime.historyIncludeImages,
        cachedInputTokens: result.cachedInputTokens,
        screen: screenLogInfo(config.model.visionEnabled, snapshot, captureError),
        comments: result.items.map((item) => item.text),
      };
      this.status = {
        state: this.running ? "running" : reason === "timer" ? "paused" : "idle",
        cycles: this.status.cycles + 1,
        lastGeneratedAt: completedAt,
        lastError: undefined,
        providerLatencyMs: durationMs,
        cachedInputTokens: result.cachedInputTokens,
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
        historyRoundsUsed: requestHistoryLength,
        historyMode: runtime?.historyMode,
        historyImagesIncluded: runtime?.historyIncludeImages,
        screen: {
          ...screenLogInfo(Boolean(config?.model.visionEnabled), snapshot, captureError),
        },
        comments: [],
        error: aborted ? undefined : errorMessage(error),
      };
      if (aborted) {
        this.status = {
          ...this.status,
          state: "paused",
          lastError: undefined,
          cachedInputTokens: undefined,
        };
      } else {
        this.status = {
          ...this.status,
          state: this.running ? "running" : "error",
          lastError: errorMessage(error),
          cachedInputTokens: undefined,
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
    this.history.splice(0);
    this.status = { ...this.status, cachedInputTokens: undefined };
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

  private rememberHistory(
    result: DanmakuGenerationResult,
    snapshot: ScreenSnapshot | undefined,
    runtime: NormalizedRuntimeSettings,
    requestHistoryLength: number,
  ): void {
    if (runtime.historyRounds <= 0) {
      this.history.splice(0);
      return;
    }

    if (
      runtime.historyMode === "reset-on-limit" &&
      requestHistoryLength >= runtime.historyRounds
    ) {
      this.history.splice(0);
      return;
    }

    if (!result.assistantText.trim()) {
      return;
    }

    this.history.push({
      userText: result.userText,
      assistantText: result.assistantText,
      snapshot: runtime.historyIncludeImages ? snapshot : undefined,
    });

    if (runtime.historyMode === "sliding" && this.history.length > runtime.historyRounds) {
      this.history.splice(0, this.history.length - runtime.historyRounds);
    }
  }

  private historyForRequest(historyRounds: number): DanmakuHistoryRound[] {
    if (historyRounds <= 0) {
      return [];
    }

    return this.history.slice(-historyRounds);
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
