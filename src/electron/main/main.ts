import { app, ipcMain, shell } from "electron";
import fs from "node:fs";
import path from "node:path";
import type { AppConfig, ConfigProfileResult, DeepPartial } from "../../shared/types";
import { ConfigStore } from "./configStore";
import { DanmakuController } from "./danmakuController";
import { GenerationLogStore } from "./generationLogStore";
import { probeScreenCapturePermission } from "./capture/screenCapture";
import {
  listOpenAICompatibleModels,
  testOpenAICompatibleConnection,
} from "./providers/openAiCompatibleProvider";
import { WindowManager } from "./windowManager";

app.setName("Danmaku Companion");

const configStore = new ConfigStore();
const generationLogStore = new GenerationLogStore();
const windowManager = new WindowManager();
const controller = new DanmakuController(
  configStore,
  generationLogStore,
  () => windowManager.getOverlayWindow(),
  (status) => windowManager.broadcastStatus(status),
);

windowManager.setController(controller);
let forceQuitTimer: NodeJS.Timeout | undefined;

function configureDockIcon(): void {
  if (process.platform !== "darwin") {
    return;
  }

  const iconPath = app.isPackaged
    ? path.join(process.resourcesPath, "icon.png")
    : path.join(process.cwd(), "build/icon.png");

  if (fs.existsSync(iconPath)) {
    app.dock?.setIcon(iconPath);
  }
  app.dock?.show();
}

function registerIpc(): void {
  async function applyProfileResult(
    result: ConfigProfileResult,
  ): Promise<ConfigProfileResult> {
    controller.clearHistory();
    await controller.refreshSchedule();
    windowManager.broadcastConfig(result.config);
    return result;
  }

  ipcMain.handle("config:get", () => configStore.get());

  ipcMain.handle("config:update", async (_event, patch: DeepPartial<AppConfig>) => {
    const config = await configStore.update(patch);
    await controller.refreshSchedule();
    windowManager.broadcastConfig(config);
    return config;
  });

  ipcMain.handle("config:profiles", () => configStore.getProfiles());

  ipcMain.handle("config:profile:create", async (_event, name: string) =>
    applyProfileResult(await configStore.createProfile(name)),
  );

  ipcMain.handle("config:profile:rename", (_event, id: string, name: string) =>
    configStore.renameProfile(id, name),
  );

  ipcMain.handle("config:profile:switch", async (_event, id: string) =>
    applyProfileResult(await configStore.switchProfile(id)),
  );

  ipcMain.handle("config:profile:delete", async (_event, id: string) =>
    applyProfileResult(await configStore.deleteProfile(id)),
  );

  ipcMain.handle("model:testConnection", async () => {
    const config = await configStore.get();
    return testOpenAICompatibleConnection(config);
  });

  ipcMain.handle("model:list", async () => {
    const config = await configStore.get();
    return listOpenAICompatibleModels(config);
  });

  ipcMain.handle("logs:get", () => generationLogStore.get());
  ipcMain.handle("logs:clear", () => generationLogStore.clear());
  ipcMain.handle("system:probeScreenRecording", () => probeScreenCapturePermission());
  ipcMain.handle("system:openScreenRecordingSettings", async () => {
    if (process.platform === "darwin") {
      await shell.openExternal(
        "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
      );
    }
  });

  ipcMain.handle("runtime:get", () => controller.getStatus());
  ipcMain.handle("runtime:start", () => controller.start());
  ipcMain.handle("runtime:stop", () => controller.stop());
  ipcMain.handle("runtime:generateOnce", () => controller.generateOnce("manual"));
  ipcMain.handle("overlay:clear", () => {
    controller.clearPendingItems();
    controller.clearHistory();
    windowManager.sendOverlayClear();
  });
  ipcMain.handle("overlay:visible", (_event, visible: boolean) => {
    windowManager.setOverlayVisible(visible);
  });
}

app.whenReady().then(async () => {
  configureDockIcon();
  registerIpc();
  windowManager.createWindows();
  windowManager.createTray();

  const config = await configStore.get();
  if (config.runtime.enabled) {
    void controller.start();
  }
});

app.on("window-all-closed", () => {});

app.on("before-quit", () => {
  app.removeAllListeners("window-all-closed");
  controller.shutdown();
  windowManager.prepareForQuit();

  if (process.platform === "win32") {
    forceQuitTimer = setTimeout(() => app.exit(0), 1500);
    forceQuitTimer.unref?.();
  }
});

app.on("will-quit", () => {
  if (forceQuitTimer) {
    clearTimeout(forceQuitTimer);
    forceQuitTimer = undefined;
  }
});
