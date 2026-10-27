import { app, ipcMain, session, shell } from "electron";
import fs from "node:fs";
import path from "node:path";
import type { ConfigProfileResult } from "../../shared/types";
import { stripRunFlag } from "./configModel";
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

// A second instance would run its own overlay and generation loop and overwrite config.json and
// the generation log with its own in-memory state, so it only hands over to the first one.
const isPrimaryInstance = app.requestSingleInstanceLock();
if (!isPrimaryInstance) {
  app.quit();
}

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
let quitFlushStarted = false;
const QUIT_FLUSH_TIMEOUT_MS = 1000;

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

/** The renderer needs no browser permissions (camera, microphone, notifications, ...). */
function denyPermissionRequests(): void {
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) =>
    callback(false),
  );
  session.defaultSession.setPermissionCheckHandler(() => false);
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

  ipcMain.handle("config:update", async (_event, patch: unknown) => {
    const config = await configStore.update(stripRunFlag(patch));
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

  ipcMain.handle("logs:get", async () => {
    const limit = await configStore.get().then(
      (config) => config.runtime.generationLogLimit,
      () => undefined,
    );
    return generationLogStore.get(limit);
  });
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
  ipcMain.handle("overlay:clear", () => controller.clearOverlay());
  ipcMain.handle("overlay:visible", (_event, visible: boolean) => {
    windowManager.setOverlayVisible(visible);
  });
}

app.on("second-instance", () => {
  void app.whenReady().then(() => windowManager.showSettings());
});

app.whenReady().then(async () => {
  if (!isPrimaryInstance) {
    return;
  }

  configureDockIcon();
  denyPermissionRequests();
  registerIpc();
  windowManager.createWindows();
  windowManager.createTray();

  const config = await configStore.get();
  windowManager.applyConfig(config);
  if (config.runtime.enabled) {
    void controller.start();
  }
});

app.on("window-all-closed", () => {});

/** Holds the quit once so queued config/log writes can land; bounded by a timeout. */
function deferQuitForPendingWrites(event: { preventDefault(): void }): void {
  if (
    quitFlushStarted ||
    (!configStore.hasPendingWrites() && !generationLogStore.hasPendingWrites())
  ) {
    return;
  }

  quitFlushStarted = true;
  event.preventDefault();
  const timeout = new Promise<void>((resolve) => setTimeout(resolve, QUIT_FLUSH_TIMEOUT_MS));
  void Promise.race([
    Promise.all([configStore.flush(), generationLogStore.flush()]),
    timeout,
  ]).finally(() => app.quit());
}

app.on("before-quit", (event) => {
  if (!isPrimaryInstance) {
    return;
  }

  app.removeAllListeners("window-all-closed");
  controller.shutdown();
  windowManager.prepareForQuit();

  if (process.platform === "win32" && !forceQuitTimer) {
    forceQuitTimer = setTimeout(() => app.exit(0), 1500);
    forceQuitTimer.unref?.();
  }
  deferQuitForPendingWrites(event);
});

app.on("will-quit", () => {
  if (forceQuitTimer) {
    clearTimeout(forceQuitTimer);
    forceQuitTimer = undefined;
  }
});
