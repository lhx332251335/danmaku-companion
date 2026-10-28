export type ProviderKind = "openai-compatible";

export type RuntimeState = "idle" | "running" | "paused" | "error";

export type DanmakuZone = "full" | "top" | "middle" | "bottom";

export type HistoryMode = "reset-on-limit" | "sliding" | "batch-sliding";

/** How history was shrunk after a request error that would otherwise repeat every cycle. */
export type HistoryRecovery = "images" | "reset";

export type ScreenImageFormat = "jpeg" | "png";

export interface OpenAICompatibleSettings {
  provider: ProviderKind;
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature: number;
  sendTemperature: boolean;
  maxTokens: number;
  timeoutMs: number;
  visionEnabled: boolean;
}

export interface CharacterProfile {
  name: string;
  persona: string;
  tone: string;
  language: string;
}

export interface UserProfile {
  name: string;
  role: string;
}

export interface PromptSettings {
  systemTemplate: string;
  userTemplate: string;
  /** Instruction for the context summary request; supports {{summaryMaxChars}}. */
  summaryTemplate: string;
}

export interface DanmakuStyleSettings {
  fontSize: number;
  opacity: number;
  speedSeconds: number;
  maxCommentLength: number;
  density: number;
  zone: DanmakuZone;
  palette: string[];
  shadow: boolean;
  /**
   * Hide the overlay from screen capture so the model does not read its own danmaku. Needs
   * Windows 10 2004+; it also hides the overlay from OBS and other screen recorders.
   */
  excludeOverlayFromCapture: boolean;
}

export interface RuntimeSettings {
  enabled: boolean;
  intervalMinSeconds: number;
  intervalMaxSeconds: number;
  intervalSeconds: number;
  /** Wait before the first capture after starting, so it is not a shot of this app's window. */
  startDelaySeconds: number;
  itemsPerCycle: number;
  itemsMinPerCycle: number;
  itemsMaxPerCycle: number;
  maxItemsPerCycle: number;
  releaseWindowMinSeconds: number;
  releaseWindowMaxSeconds: number;
  releaseWindowSeconds: number;
  captureMaxEdgePixels: number;
  captureImageFormat: ScreenImageFormat;
  captureJpegQuality: number;
  historyRounds: number;
  historyMode: HistoryMode;
  historyIncludeImages: boolean;
  /** Screenshots kept in history before the oldest are dropped in a batch. */
  historyMaxImages: number;
  /** Ceiling for the serialized request body in MiB; history screenshots are dropped to stay under it. */
  requestBodyLimitMB: number;
  /**
   * Before reset-on-limit starts over or batch-sliding halves the window, summarize the session
   * in a background request and keep that summary in the system prompt afterwards.
   */
  historySummaryEnabled: boolean;
  historySummaryMaxChars: number;
  persistScreenshots: boolean;
  generationLogLimit: number;
  privacyBlacklist: string[];
}

export interface AppConfig {
  version: number;
  model: OpenAICompatibleSettings;
  character: CharacterProfile;
  user: UserProfile;
  prompt: PromptSettings;
  danmaku: DanmakuStyleSettings;
  runtime: RuntimeSettings;
}

export interface ConfigProfileSummary {
  id: string;
  name: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ConfigProfilesSnapshot {
  activeProfileId: string;
  profiles: ConfigProfileSummary[];
}

export interface ConfigProfileResult {
  config: AppConfig;
  profiles: ConfigProfilesSnapshot;
}

export interface RuntimeStatus {
  state: RuntimeState;
  cycles: number;
  lastGeneratedAt?: string;
  lastError?: string;
  providerLatencyMs?: number;
  cachedInputTokens?: number;
  promptTokens?: number;
  requestBytes?: number;
  /** Effective body limit: the configured one, or lower when learned from a 413. */
  requestLimitBytes?: number;
  historyImages?: number;
  /** When the next timed generation is due (ISO time), while one is scheduled. */
  nextCycleAt?: string;
  /** Summary of earlier rounds currently carried in the system prompt. */
  contextSummary?: string;
  contextSummaryAt?: string;
  /** A context summary request is running in the background. */
  summarizing?: boolean;
}

export interface ConnectionTestResult {
  ok: boolean;
  endpoint: string;
  message: string;
  models?: string[];
}

export interface ModelOption {
  id: string;
  name?: string;
  state?: "loaded" | "not-loaded" | string;
  type?: string;
  vision?: boolean;
}

export interface ModelListResult {
  ok: boolean;
  endpoint: string;
  message: string;
  models: ModelOption[];
}

export interface ScreenCaptureProbeResult {
  ok: boolean;
  status: string;
  message: string;
}

export interface ScreenSnapshot {
  dataUrl: string;
  width: number;
  height: number;
  format: ScreenImageFormat;
  mediaType: string;
  imageBytes: number;
  dataUrlBytes: number;
  jpegQuality?: number;
  capturedAt: string;
  sourceName: string;
}

export interface DanmakuHistoryRound {
  userText: string;
  assistantText: string;
  snapshot?: ScreenSnapshot;
  /** The screenshot of this round was dropped to keep requests under the size budget. */
  imageOmitted?: boolean;
}

export interface DanmakuInput {
  snapshot?: ScreenSnapshot;
  activeAppName?: string;
  character: CharacterProfile;
  history?: DanmakuHistoryRound[];
  maxItems: number;
  /** Summary of rounds dropped from history, added to the system prompt. */
  contextSummary?: string;
  /** The provider refuses to send a body larger than this (bytes). */
  maxBodyBytes?: number;
  abortSignal?: AbortSignal;
}

export interface DanmakuGenerationResult {
  items: DanmakuItem[];
  userText: string;
  /** The answer without inline reasoning; this is what history keeps. */
  assistantText: string;
  /** The content exactly as the server returned it (may include inline reasoning). */
  rawOutput?: string;
  finishReason?: string;
  cachedInputTokens?: number;
  promptTokens?: number;
  completionTokens?: number;
  promptMs?: number;
  /** Size of the request body that was sent. */
  requestBytes?: number;
}

export interface ContextSummaryResult {
  /** The summary text, without reasoning. */
  text: string;
  rawOutput?: string;
  finishReason?: string;
  cachedInputTokens?: number;
  promptTokens?: number;
  completionTokens?: number;
  promptMs?: number;
  requestBytes?: number;
  historyImagesSent?: number;
}

export interface DanmakuItem {
  id: string;
  text: string;
  color?: string;
  lane?: number;
  speedSeconds?: number;
  createdAt: string;
  source?: "model" | "system";
}

export type GenerationLogStatus = "success" | "error" | "aborted";

export interface GenerationLogScreenInfo {
  enabled: boolean;
  captured: boolean;
  width?: number;
  height?: number;
  format?: ScreenImageFormat;
  imageBytes?: number;
  dataUrlBytes?: number;
  jpegQuality?: number;
  sourceName?: string;
  capturedAt?: string;
  /** The screenshot was re-encoded smaller because it alone exceeded the request budget. */
  resizedToFit?: boolean;
  error?: string;
}

export interface GenerationLogCompaction {
  /**
   * "budget": a configured limit was exceeded; "413": the server rejected the request size;
   * "reset": the connection was reset while a large request was uploading.
   */
  trigger: "budget" | "413" | "reset";
  reason: "images" | "bytes";
  droppedImages: number;
}

export interface GenerationLogEntry {
  id: string;
  cycle: number;
  reason: "manual" | "timer" | "summary";
  status: GenerationLogStatus;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  model?: string;
  requestedCount?: number;
  generatedCount?: number;
  releaseWindowSeconds?: number;
  historyRoundsUsed?: number;
  historyMode?: HistoryMode;
  historyImagesIncluded?: boolean;
  cachedInputTokens?: number;
  promptTokens?: number;
  completionTokens?: number;
  promptMs?: number;
  /** "length" when the reply hit max_tokens and was cut off. */
  finishReason?: string;
  requestBytes?: number;
  bodyLimitBytes?: number;
  historyImagesSent?: number;
  compaction?: GenerationLogCompaction[];
  historyRecovery?: HistoryRecovery;
  screen: GenerationLogScreenInfo;
  comments: string[];
  /** For reason "summary": the context summary that was written. */
  summary?: string;
  rawOutput?: string;
  error?: string;
}

export type DeepPartial<T> = T extends readonly unknown[]
  ? T
  : {
      [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
    };

export interface DanmakuBridge {
  getConfig(): Promise<AppConfig>;
  updateConfig(config: DeepPartial<AppConfig>): Promise<AppConfig>;
  getConfigProfiles(): Promise<ConfigProfilesSnapshot>;
  createConfigProfile(name: string): Promise<ConfigProfileResult>;
  renameConfigProfile(id: string, name: string): Promise<ConfigProfilesSnapshot>;
  switchConfigProfile(id: string): Promise<ConfigProfileResult>;
  deleteConfigProfile(id: string): Promise<ConfigProfileResult>;
  testModelConnection(): Promise<ConnectionTestResult>;
  listModels(): Promise<ModelListResult>;
  getGenerationLogs(): Promise<GenerationLogEntry[]>;
  clearGenerationLogs(): Promise<void>;
  probeScreenRecording(): Promise<ScreenCaptureProbeResult>;
  openScreenRecordingSettings(): Promise<void>;
  getRuntimeStatus(): Promise<RuntimeStatus>;
  start(): Promise<RuntimeStatus>;
  stop(): Promise<RuntimeStatus>;
  generateOnce(): Promise<RuntimeStatus>;
  clearOverlay(): Promise<void>;
  setOverlayVisible(visible: boolean): Promise<void>;
  onDanmakuItems(callback: (items: DanmakuItem[]) => void): () => void;
  onRuntimeStatus(callback: (status: RuntimeStatus) => void): () => void;
  onConfigUpdated(callback: (config: AppConfig) => void): () => void;
  onOverlayClear(callback: () => void): () => void;
}
