import { defaultAppConfig } from "../shared/defaultConfig";
import type { AppConfig, DanmakuBridge } from "../shared/types";

function cloneConfig(config: AppConfig): AppConfig {
  return JSON.parse(JSON.stringify(config)) as AppConfig;
}

export function api(): DanmakuBridge {
  if (window.danmaku) {
    return window.danmaku;
  }

  let config = defaultAppConfig;
  let activeProfileId = "preview-profile";
  let profileConfigs: Record<string, AppConfig> = {
    [activeProfileId]: config,
  };
  let configProfiles = [
    {
      id: activeProfileId,
      name: "默认配置",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  ];
  let running = false;
  let generationLogs: Awaited<ReturnType<DanmakuBridge["getGenerationLogs"]>> = [];
  const statusListeners = new Set<Parameters<DanmakuBridge["onRuntimeStatus"]>[0]>();
  const itemListeners = new Set<Parameters<DanmakuBridge["onDanmakuItems"]>[0]>();
  const configListeners = new Set<Parameters<DanmakuBridge["onConfigUpdated"]>[0]>();
  const clearListeners = new Set<Parameters<DanmakuBridge["onOverlayClear"]>[0]>();

  function profileSnapshot() {
    return {
      activeProfileId,
      profiles: configProfiles.map((profile) => ({
        ...profile,
        active: profile.id === activeProfileId,
      })),
    };
  }

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
      profileConfigs[activeProfileId] = config;
      configProfiles = configProfiles.map((profile) =>
        profile.id === activeProfileId
          ? { ...profile, updatedAt: new Date().toISOString() }
          : profile,
      );
      configListeners.forEach((listener) => listener(config));
      return config;
    },
    getConfigProfiles: async () => profileSnapshot(),
    createConfigProfile: async (name) => {
      const now = new Date().toISOString();
      const id = `${Date.now()}-profile`;
      activeProfileId = id;
      config = cloneConfig(config);
      profileConfigs[id] = config;
      configProfiles = [
        ...configProfiles,
        {
          id,
          name: name.trim() || "默认配置 副本",
          createdAt: now,
          updatedAt: now,
        },
      ];
      configListeners.forEach((listener) => listener(config));
      return { config, profiles: profileSnapshot() };
    },
    renameConfigProfile: async (id, name) => {
      configProfiles = configProfiles.map((profile) =>
        profile.id === id
          ? { ...profile, name: name.trim() || profile.name, updatedAt: new Date().toISOString() }
          : profile,
      );
      return profileSnapshot();
    },
    switchConfigProfile: async (id) => {
      if (profileConfigs[id]) {
        activeProfileId = id;
        config = profileConfigs[id];
        configListeners.forEach((listener) => listener(config));
      }
      return { config, profiles: profileSnapshot() };
    },
    deleteConfigProfile: async (id) => {
      if (configProfiles.length > 1) {
        configProfiles = configProfiles.filter((profile) => profile.id !== id);
        delete profileConfigs[id];
        if (activeProfileId === id) {
          activeProfileId = configProfiles[0].id;
          config = profileConfigs[activeProfileId];
        }
        configListeners.forEach((listener) => listener(config));
      }
      return { config, profiles: profileSnapshot() };
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
          rawOutput: JSON.stringify({ comments: ["预览弹幕已经就位"] }, null, 2),
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
    onConfigUpdated: (callback) => {
      configListeners.add(callback);
      return () => configListeners.delete(callback);
    },
    onOverlayClear: (callback) => {
      clearListeners.add(callback);
      return () => clearListeners.delete(callback);
    },
  };

  window.danmaku = bridge;
  return bridge;
}
