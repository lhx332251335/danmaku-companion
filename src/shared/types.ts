export type ProviderKind = "openai-compatible";

export type RuntimeState = "idle" | "running" | "paused" | "error";

export type DanmakuZone = "full" | "top" | "middle" | "bottom";

export type HistoryMode = "reset-on-limit" | "sliding";

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
}

export interface RuntimeSettings {
  enabled: boolean;
  intervalMinSeconds: number;
  intervalMaxSeconds: number;
  intervalSeconds: number;
  itemsPerCycle: number;
  itemsMinPerCycle: number;
  itemsMaxPerCycle: number;
  maxItemsPerCycle: number;
  releaseWindowMinSeconds: number;
  releaseWindowMaxSeconds: number;
  releaseWindowSeconds: number;
  captureMaxEdgePixels: number;
  historyRounds: number;
  historyMode: HistoryMode;
  historyIncludeImages: boolean;
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

export interface RuntimeStatus {
  state: RuntimeState;
  cycles: number;
  lastGeneratedAt?: string;
  lastError?: string;
  providerLatencyMs?: number;
  cachedInputTokens?: number;
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
  capturedAt: string;
  sourceName: string;
}

export interface DanmakuHistoryRound {
  userText: string;
  assistantText: string;
  snapshot?: ScreenSnapshot;
}

export interface DanmakuInput {
  snapshot?: ScreenSnapshot;
  activeAppName?: string;
  character: CharacterProfile;
  history?: DanmakuHistoryRound[];
  maxItems: number;
  abortSignal?: AbortSignal;
}

export interface DanmakuGenerationResult {
  items: DanmakuItem[];
  userText: string;
  assistantText: string;
  cachedInputTokens?: number;
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
  sourceName?: string;
  capturedAt?: string;
  error?: string;
}

export interface GenerationLogEntry {
  id: string;
  cycle: number;
  reason: "manual" | "timer";
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
  screen: GenerationLogScreenInfo;
  comments: string[];
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
