import { contextBridge, ipcRenderer } from "electron";
import type {
  AppConfig,
  ConfigProfileResult,
  ConfigProfilesSnapshot,
  DanmakuBridge,
  GenerationLogEntry,
  DanmakuItem,
  ModelListResult,
  DeepPartial,
  RuntimeStatus,
  ScreenCaptureProbeResult,
} from "../../shared/types";

const bridge: DanmakuBridge = {
  getConfig: () => ipcRenderer.invoke("config:get") as Promise<AppConfig>,
  updateConfig: (config: DeepPartial<AppConfig>) =>
    ipcRenderer.invoke("config:update", config) as Promise<AppConfig>,
  getConfigProfiles: () =>
    ipcRenderer.invoke("config:profiles") as Promise<ConfigProfilesSnapshot>,
  createConfigProfile: (name: string) =>
    ipcRenderer.invoke("config:profile:create", name) as Promise<ConfigProfileResult>,
  renameConfigProfile: (id: string, name: string) =>
    ipcRenderer.invoke("config:profile:rename", id, name) as Promise<ConfigProfilesSnapshot>,
  switchConfigProfile: (id: string) =>
    ipcRenderer.invoke("config:profile:switch", id) as Promise<ConfigProfileResult>,
  deleteConfigProfile: (id: string) =>
    ipcRenderer.invoke("config:profile:delete", id) as Promise<ConfigProfileResult>,
  testModelConnection: () =>
    ipcRenderer.invoke("model:testConnection") as Promise<
      import("../../shared/types").ConnectionTestResult
    >,
  listModels: () => ipcRenderer.invoke("model:list") as Promise<ModelListResult>,
  getGenerationLogs: () =>
    ipcRenderer.invoke("logs:get") as Promise<GenerationLogEntry[]>,
  clearGenerationLogs: () => ipcRenderer.invoke("logs:clear") as Promise<void>,
  probeScreenRecording: () =>
    ipcRenderer.invoke("system:probeScreenRecording") as Promise<ScreenCaptureProbeResult>,
  openScreenRecordingSettings: () =>
    ipcRenderer.invoke("system:openScreenRecordingSettings") as Promise<void>,
  getRuntimeStatus: () => ipcRenderer.invoke("runtime:get") as Promise<RuntimeStatus>,
  start: () => ipcRenderer.invoke("runtime:start") as Promise<RuntimeStatus>,
  stop: () => ipcRenderer.invoke("runtime:stop") as Promise<RuntimeStatus>,
  generateOnce: () =>
    ipcRenderer.invoke("runtime:generateOnce") as Promise<RuntimeStatus>,
  clearOverlay: () => ipcRenderer.invoke("overlay:clear") as Promise<void>,
  setOverlayVisible: (visible: boolean) =>
    ipcRenderer.invoke("overlay:visible", visible) as Promise<void>,
  onDanmakuItems: (callback: (items: DanmakuItem[]) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, items: DanmakuItem[]) =>
      callback(items);
    ipcRenderer.on("danmaku:items", listener);
    return () => ipcRenderer.off("danmaku:items", listener);
  },
  onRuntimeStatus: (callback: (status: RuntimeStatus) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, status: RuntimeStatus) =>
      callback(status);
    ipcRenderer.on("runtime:status", listener);
    return () => ipcRenderer.off("runtime:status", listener);
  },
  onConfigUpdated: (callback: (config: AppConfig) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, config: AppConfig) =>
      callback(config);
    ipcRenderer.on("config:updated", listener);
    return () => ipcRenderer.off("config:updated", listener);
  },
  onOverlayClear: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on("overlay:clear", listener);
    return () => ipcRenderer.off("overlay:clear", listener);
  },
};

contextBridge.exposeInMainWorld("danmaku", bridge);
