import { defaultAppConfig } from "../shared/defaultConfig";
import type { DanmakuBridge } from "../shared/types";

export function api(): DanmakuBridge {
  if (window.danmaku) {
    return window.danmaku;
  }

  let config = defaultAppConfig;
  let running = false;
  let generationLogs: Awaited<ReturnType<DanmakuBridge["getGenerationLogs"]>> = [];
  const statusListeners = new Set<Parameters<DanmakuBridge["onRuntimeStatus"]>[0]>();
  const itemListeners = new Set<Parameters<DanmakuBridge["onDanmakuItems"]>[0]>();
  const clearListeners = new Set<Parameters<DanmakuBridge["onOverlayClear"]>[0]>();

  const bridge: DanmakuBridge = {
    getConfig: async () => config,
    updateConfig: async (patch) => {
      config = {
        ...config,
        ...patch,
        model: { ...config.model, ...patch.model },
        character: { ...config.character, ...patch.character },
        user: { ...config.user, ...patch.user },
        prompt: { ...config.prompt, ...patch.prompt },
        danmaku: {
          ...config.danmaku,
          ...patch.danmaku,
          palette: patch.danmaku?.palette ?? config.danmaku.palette,
        },
        runtime: {
          ...config.runtime,
          ...patch.runtime,
          privacyBlacklist:
            patch.runtime?.privacyBlacklist ?? config.runtime.privacyBlacklist,
        },
      };
      return config;
    },
    testModelConnection: async () => ({
      ok: true,
      endpoint: `${config.model.baseUrl.replace(/\/+$/, "")}/models`,
      message: "Preview connection OK.",
      models: [config.model.model],
    }),
    listModels: async () => ({
      ok: true,
      endpoint: `${config.model.baseUrl.replace(/\/+$/, "")}/models`,
      message: "Preview models loaded.",
      models: [{ id: config.model.model, state: "loaded" }],
    }),
    getGenerationLogs: async () => generationLogs,
    clearGenerationLogs: async () => {
      generationLogs = [];
    },
    probeScreenRecording: async () => ({
      ok: true,
      status: "granted",
      message: "Preview screen recording is available.",
    }),
    openScreenRecordingSettings: async () => undefined,
    getRuntimeStatus: async () => ({ state: running ? "running" : "idle", cycles: 0 }),
    start: async () => {
      running = true;
      const status = { state: "running" as const, cycles: 0 };
      statusListeners.forEach((listener) => listener(status));
      return status;
    },
    stop: async () => {
      running = false;
      const status = { state: "paused" as const, cycles: 0 };
      statusListeners.forEach((listener) => listener(status));
      return status;
    },
    generateOnce: async () => {
      generationLogs = [
        {
          id: `${Date.now()}-preview-log`,
          cycle: 1,
          reason: "manual" as const,
          status: "success" as const,
          startedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
          durationMs: 320,
          model: config.model.model,
          requestedCount: config.runtime.itemsPerCycle,
          generatedCount: 1,
          releaseWindowSeconds: config.runtime.releaseWindowMaxSeconds,
          historyRoundsUsed: 0,
          historyMode: config.runtime.historyMode,
          historyImagesIncluded: config.runtime.historyIncludeImages,
          screen: {
            enabled: config.model.visionEnabled,
            captured: config.model.visionEnabled,
            width: 960,
            height: 540,
            sourceName: "Preview",
            capturedAt: new Date().toISOString(),
          },
          comments: ["预览弹幕已经就位"],
        },
        ...generationLogs,
      ].slice(0, config.runtime.generationLogLimit);
      itemListeners.forEach((listener) =>
        listener([
          {
            id: `${Date.now()}-preview`,
            text: "预览弹幕已经就位",
            createdAt: new Date().toISOString(),
            source: "system",
          },
        ]),
      );
      return { state: running ? "running" : "idle", cycles: 1 };
    },
    clearOverlay: async () => clearListeners.forEach((listener) => listener()),
    setOverlayVisible: async () => undefined,
    onDanmakuItems: (callback) => {
      itemListeners.add(callback);
      return () => itemListeners.delete(callback);
    },
    onRuntimeStatus: (callback) => {
      statusListeners.add(callback);
      return () => statusListeners.delete(callback);
    },
    onOverlayClear: (callback) => {
      clearListeners.add(callback);
      return () => clearListeners.delete(callback);
    },
  };

  window.danmaku = bridge;
  return bridge;
}
