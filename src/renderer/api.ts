import { defaultAppConfig } from "../shared/defaultConfig";
import type {
  AppConfig,
  DanmakuBridge,
  GenerationLogEntry,
  ModelOption,
  RuntimeStatus,
} from "../shared/types";
import {
  buildPreviewData,
  previewItems,
  previewRound,
  previewScenario,
  type PreviewScenario,
} from "./previewData";

function cloneConfig(config: AppConfig): AppConfig {
  return JSON.parse(JSON.stringify(config)) as AppConfig;
}

export const BRIDGE_MISSING_MESSAGE =
  "无法连接到主进程（预加载脚本没有加载），设置不会被保存，也无法启动生成。请重启应用；如果问题依旧，请重新安装。";

/** The preview mock is for opening the renderer in a normal browser, never inside Electron. */
export function isElectronUserAgent(userAgent: string): boolean {
  return /\bElectron\//.test(userAgent);
}

/** ?demo=running|delay|paused|idle|error in a plain browser loads sample data. */
function currentScenario(): PreviewScenario | undefined {
  const search = typeof window.location?.search === "string" ? window.location.search : "";
  return previewScenario(search);
}

export function api(): DanmakuBridge {
  if (window.danmaku) {
    return window.danmaku;
  }

  if (isElectronUserAgent(navigator.userAgent)) {
    throw new Error(BRIDGE_MISSING_MESSAGE);
  }

  const scenario = currentScenario();
  const demo = scenario ? buildPreviewData(scenario) : undefined;

  let config = demo
    ? (demo.profiles.find((profile) => profile.id === demo.activeProfileId)?.config ?? defaultAppConfig)
    : defaultAppConfig;
  let activeProfileId = demo?.activeProfileId ?? "preview-profile";
  let profileConfigs: Record<string, AppConfig> = demo
    ? Object.fromEntries(demo.profiles.map((profile) => [profile.id, profile.config]))
    : { [activeProfileId]: config };
  let configProfiles = demo
    ? demo.profiles.map(({ config: _config, ...profile }) => profile)
    : [
        {
          id: activeProfileId,
          name: "默认配置",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ];
  let running = demo?.status.state === "running";
  let cycles = demo?.status.cycles ?? 0;
  let generationLogs: GenerationLogEntry[] = demo?.logs ?? [];
  /** Demo only: the full status the sample data describes. */
  let demoStatus: RuntimeStatus | undefined = demo?.status;
  let demoTimer: number | undefined;
  const models: ModelOption[] = demo?.models ?? [];
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

  function broadcast(status: RuntimeStatus) {
    statusListeners.forEach((listener) => listener(status));
  }

  /* ---------------- demo runtime: a live, re-arming countdown ---------------- */

  function demoRound(reason: GenerationLogEntry["reason"]): RuntimeStatus {
    cycles += 1;
    const random = Math.random;
    const entry = previewRound({ cycle: cycles, completedAt: Date.now(), random, config, reason });
    entry.id = `${Date.now()}-demo-log`;
    generationLogs = [entry, ...generationLogs].slice(0, config.runtime.generationLogLimit);
    const items = previewItems(entry.comments, config.danmaku.palette);
    itemListeners.forEach((listener) => listener(items));
    demoStatus = {
      ...(demoStatus ?? { state: "idle", cycles }),
      state: running ? "running" : demoStatus?.state === "paused" ? "paused" : "idle",
      cycles,
      lastError: undefined,
      lastGeneratedAt: entry.completedAt,
      providerLatencyMs: entry.durationMs,
      cachedInputTokens: entry.cachedInputTokens,
      promptTokens: entry.promptTokens,
      requestBytes: entry.requestBytes,
      requestLimitBytes: config.runtime.requestBodyLimitMB * 1024 * 1024,
      historyImages: Math.min(cycles, 6),
    };
    return demoStatus;
  }

  function clearDemoTimer() {
    if (demoTimer !== undefined) {
      window.clearTimeout(demoTimer);
      demoTimer = undefined;
    }
  }

  /** Schedules the next demo capture `delayMs` from now and broadcasts the countdown. */
  function armDemoCycle(delayMs: number, first = false) {
    clearDemoTimer();
    const now = Date.now();
    demoStatus = {
      ...(demoStatus ?? { state: "running", cycles }),
      state: "running",
      nextCycleAt: new Date(now + delayMs).toISOString(),
      nextCycleArmedAt: new Date(now).toISOString(),
      nextCycleIsFirst: first || undefined,
    };
    demoTimer = window.setTimeout(runDemoCycle, delayMs);
  }

  function runDemoCycle() {
    demoTimer = undefined;
    if (!running || !demoStatus) return;
    // Generating: nothing scheduled while the request runs.
    demoStatus = { ...demoStatus, nextCycleAt: undefined, nextCycleArmedAt: undefined, nextCycleIsFirst: undefined };
    broadcast(demoStatus);
    demoTimer = window.setTimeout(() => {
      if (!running) return;
      demoRound("timer");
      const { intervalMinSeconds: min, intervalMaxSeconds: max } = config.runtime;
      armDemoCycle(Math.round((min + Math.random() * Math.max(0, max - min)) * 1000));
      broadcast(demoStatus as RuntimeStatus);
    }, 2400);
  }

  if (demo && running && demoStatus?.nextCycleAt) {
    const remaining = Math.max(0, Date.parse(demoStatus.nextCycleAt) - Date.now());
    demoTimer = window.setTimeout(runDemoCycle, remaining);
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
      const baseName = configProfiles.find((profile) => profile.id === activeProfileId)?.name;
      activeProfileId = id;
      config = cloneConfig(config);
      profileConfigs[id] = config;
      configProfiles = [
        ...configProfiles,
        {
          id,
          name: name.trim() || `${baseName ?? "默认配置"} 副本`,
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
      message: demo ? `Connected. ${models.length} model(s) found.` : "Preview connection OK.",
      models: demo ? models.map((model) => model.id) : [config.model.model],
    }),
    listModels: async () => ({
      ok: true,
      endpoint: `${config.model.baseUrl.replace(/\/+$/, "")}/models`,
      message: demo ? `${models.length} model(s) found from 1 endpoint(s).` : "Preview models loaded.",
      models: demo ? models : [{ id: config.model.model, state: "loaded" }],
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
    getRuntimeStatus: async () =>
      demoStatus ?? { state: running ? "running" : "idle", cycles },
    start: async () => {
      running = true;
      if (demo) {
        armDemoCycle(Math.round(config.runtime.startDelaySeconds * 1000), true);
        demoStatus = { ...(demoStatus as RuntimeStatus), lastError: undefined };
        broadcast(demoStatus);
        return demoStatus;
      }
      const status = { state: "running" as const, cycles };
      broadcast(status);
      return status;
    },
    stop: async () => {
      running = false;
      if (demo) {
        clearDemoTimer();
        demoStatus = {
          ...(demoStatus ?? { cycles }),
          state: "paused",
          nextCycleAt: undefined,
          nextCycleArmedAt: undefined,
          nextCycleIsFirst: undefined,
        };
        broadcast(demoStatus);
        return demoStatus;
      }
      const status = { state: "paused" as const, cycles };
      broadcast(status);
      return status;
    },
    generateOnce: async () => {
      if (demo) {
        await new Promise((resolve) => window.setTimeout(resolve, 900));
        const status = demoRound("manual");
        broadcast(status);
        return status;
      }
      cycles += 1;
      generationLogs = [
        {
          id: `${Date.now()}-preview-log`,
          cycle: cycles,
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
            format: config.runtime.captureImageFormat,
            imageBytes: 86000,
            dataUrlBytes: 115000,
            jpegQuality:
              config.runtime.captureImageFormat === "jpeg"
                ? config.runtime.captureJpegQuality
                : undefined,
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
      const status = {
        state: running ? ("running" as const) : ("idle" as const),
        cycles,
        lastGeneratedAt: new Date().toISOString(),
      };
      broadcast(status);
      return status;
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
