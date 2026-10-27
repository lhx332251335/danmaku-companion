import {
  BrowserWindow,
  Menu,
  Tray,
  app,
  globalShortcut,
  nativeImage,
  screen,
} from "electron";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { defaultAppConfig } from "../../shared/defaultConfig";
import type { AppConfig, RuntimeStatus } from "../../shared/types";
import type { DanmakuController } from "./danmakuController";
import {
  formatAccelerator,
  isAppUrl,
  overlayRecoveryDelay,
  recordOverlayCrash,
  sameBounds,
  supportsCaptureExclusion,
} from "./windowPolicy";

const APP_NAME = "Danmaku Companion";
/** Give the overlay renderer time to load before showing a startup notice on it. */
const SHORTCUT_NOTICE_DELAY_MS = 3000;

const trayIconSvg = Buffer.from(`
<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 18 18">
  <path fill="#000" d="M3 5.25h12v2H3zM1.75 10.75h8.25v2H1.75zM12 10.75h4.25v2H12z"/>
</svg>`);

function appResourcePath(fileName: string): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, fileName)
    : path.join(process.cwd(), "build", fileName);
}

function createTrayIcon(): Electron.NativeImage {
  if (process.platform === "darwin") {
    const image = nativeImage.createFromDataURL(
      `data:image/svg+xml;base64,${trayIconSvg.toString("base64")}`,
    );
    image.setTemplateImage(true);
    return image;
  }

  const candidates = [appResourcePath("icon.ico"), appResourcePath("icon.png")];
  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) {
      continue;
    }

    const image = nativeImage.createFromPath(candidate);
    if (!image.isEmpty()) {
      return candidate.endsWith(".png") ? image.resize({ width: 16, height: 16 }) : image;
    }
  }

  return nativeImage.createFromDataURL(
    `data:image/svg+xml;base64,${trayIconSvg.toString("base64")}`,
  );
}

function rendererIndexPath(): string {
  return app.isPackaged
    ? path.join(app.getAppPath(), "dist/renderer/index.html")
    : path.join(process.cwd(), "dist/renderer/index.html");
}

function appEntryUrl(): string {
  return process.env.VITE_DEV_SERVER_URL || pathToFileURL(rendererIndexPath()).href;
}

function secureWebPreferences(): Electron.WebPreferences {
  return {
    contextIsolation: true,
    nodeIntegration: false,
    // The preload only requires contextBridge/ipcRenderer, which a sandboxed preload may use.
    sandbox: true,
    preload: path.join(__dirname, "../preload/index.js"),
  };
}

/** Keep our windows on the app's own page: no popups, no navigation to dropped links or files. */
function guardNavigation(contents: Electron.WebContents): void {
  contents.setWindowOpenHandler(() => ({ action: "deny" }));
  contents.on("will-navigate", (event) => {
    if (!isAppUrl(event.url, appEntryUrl())) {
      event.preventDefault();
      console.warn(`Blocked navigation to ${event.url}`);
    }
  });
}

export class WindowManager {
  private settingsWindow: BrowserWindow | undefined;
  private overlayWindow: BrowserWindow | undefined;
  private tray: Tray | undefined;
  private controller: DanmakuController | undefined;
  private latestStatus: RuntimeStatus = { state: "idle", cycles: 0 };
  private overlayVisible = true;
  private overlayFullscreenSpacesConfigured = false;
  private overlayCrashTimes: number[] = [];
  private overlayRecoveryTimer: NodeJS.Timeout | undefined;
  private excludeOverlayFromCapture = defaultAppConfig.danmaku.excludeOverlayFromCapture;
  private captureExclusionWarned = false;
  private failedShortcuts: string[] = [];
  private quitting = false;
  private readonly handleDisplayChange = (): void => {
    this.fitOverlayToPrimaryDisplay();
    if (this.liveOverlay()?.isVisible()) {
      this.applyOverlayWindowLevel();
    }
  };
  private readonly handleChildProcessGone = (
    _event: Electron.Event,
    details: Electron.Details,
  ): void => {
    if (details.type === "GPU" && details.reason !== "clean-exit") {
      this.scheduleOverlayRecovery(`GPU process ${details.reason}`);
    }
  };

  setController(controller: DanmakuController): void {
    this.controller = controller;
  }

  createWindows(): void {
    screen.on("display-metrics-changed", this.handleDisplayChange);
    screen.on("display-added", this.handleDisplayChange);
    screen.on("display-removed", this.handleDisplayChange);
    app.on("child-process-gone", this.handleChildProcessGone);
    this.createOverlayWindow();
    this.createSettingsWindow();
    this.registerShortcuts();
  }

  createTray(): void {
    this.tray = new Tray(createTrayIcon());
    if (process.platform === "darwin") {
      this.tray.setTitle("弹幕");
      app.dock?.show();
    }
    if (process.platform === "win32") {
      this.tray.on("click", () => this.showSettings());
    }
    this.tray.setToolTip(
      this.failedShortcuts.length > 0
        ? `${APP_NAME}\n快捷键未生效：${this.failedShortcuts.join("、")}`
        : APP_NAME,
    );
    this.updateTrayMenu();
  }

  showSettings(): void {
    if (!this.settingsWindow || this.settingsWindow.isDestroyed()) {
      this.createSettingsWindow();
    }

    const window = this.settingsWindow;
    if (!window) {
      return;
    }
    if (window.isMinimized()) {
      window.restore();
    }
    window.show();
    window.focus();
  }

  /**
   * Overlay to push danmaku to. Called for every released item, so it only shows the window when
   * it is hidden and re-asserts topmost at most every few seconds.
   */
  getOverlayWindow(): BrowserWindow | undefined {
    const overlay = this.ensureOverlayWindow();
    if (overlay && this.overlayVisible) {
      if (!overlay.isVisible()) {
        this.showOverlayWindow();
      } else {
        // Re-assert on every item: another topmost window (a game, a video player) may have
        // covered the overlay since the last one. setAlwaysOnTop/moveTop are cheap.
        this.applyOverlayWindowLevel();
      }
    }

    return overlay;
  }

  applyConfig(config: AppConfig): void {
    this.excludeOverlayFromCapture = config.danmaku.excludeOverlayFromCapture;
    this.applyOverlayCaptureExclusion();
  }

  broadcastStatus(status: RuntimeStatus): void {
    this.latestStatus = status;
    this.settingsWindow?.webContents.send("runtime:status", status);
    this.updateTrayMenu();
  }

  broadcastConfig(config: AppConfig): void {
    this.applyConfig(config);
    this.settingsWindow?.webContents.send("config:updated", config);
    this.overlayWindow?.webContents.send("config:updated", config);
  }

  setOverlayVisible(visible: boolean): void {
    this.overlayVisible = visible;

    const overlay = this.liveOverlay();
    if (!overlay) {
      return;
    }

    if (visible) {
      this.showOverlayWindow();
    } else {
      overlay.hide();
    }
  }

  sendOverlayClear(): void {
    this.overlayWindow?.webContents.send("overlay:clear");
  }

  prepareForQuit(): void {
    this.quitting = true;
    if (this.overlayRecoveryTimer) {
      clearTimeout(this.overlayRecoveryTimer);
      this.overlayRecoveryTimer = undefined;
    }
    screen.off("display-metrics-changed", this.handleDisplayChange);
    screen.off("display-added", this.handleDisplayChange);
    screen.off("display-removed", this.handleDisplayChange);
    app.off("child-process-gone", this.handleChildProcessGone);
    globalShortcut.unregisterAll();
    this.tray?.destroy();
    this.tray = undefined;

    if (this.overlayWindow && !this.overlayWindow.isDestroyed()) {
      this.overlayWindow.destroy();
    }
    if (this.settingsWindow && !this.settingsWindow.isDestroyed()) {
      this.settingsWindow.destroy();
    }
  }

  private createSettingsWindow(): void {
    this.settingsWindow = new BrowserWindow({
      width: 1120,
      height: 760,
      minWidth: 940,
      minHeight: 660,
      title: APP_NAME,
      backgroundColor: "#f6f8fb",
      webPreferences: secureWebPreferences(),
    });

    guardNavigation(this.settingsWindow.webContents);
    void this.loadView(this.settingsWindow, "settings");

    this.settingsWindow.on("closed", () => {
      this.settingsWindow = undefined;
    });
  }

  private liveOverlay(): BrowserWindow | undefined {
    const overlay = this.overlayWindow;
    return overlay && !overlay.isDestroyed() ? overlay : undefined;
  }

  /** Recreate the overlay if it was closed, unless a crash recovery is already scheduled. */
  private ensureOverlayWindow(): BrowserWindow | undefined {
    if (!this.liveOverlay() && !this.quitting && !this.overlayRecoveryTimer) {
      this.createOverlayWindow();
    }

    return this.liveOverlay();
  }

  private scheduleOverlayRecovery(reason: string): void {
    if (this.quitting || this.overlayRecoveryTimer) {
      return;
    }

    this.overlayCrashTimes = recordOverlayCrash(this.overlayCrashTimes, Date.now());
    const delayMs = overlayRecoveryDelay(this.overlayCrashTimes);
    if (delayMs === undefined) {
      console.error(`Overlay failed again (${reason}); giving up on recreating it.`);
      return;
    }

    console.warn(`Overlay failed (${reason}); recreating it in ${delayMs} ms.`);
    this.overlayRecoveryTimer = setTimeout(() => {
      this.overlayRecoveryTimer = undefined;
      this.recreateOverlayWindow();
    }, delayMs);
  }

  private recreateOverlayWindow(): void {
    if (this.quitting) {
      return;
    }

    const previous = this.overlayWindow;
    this.overlayWindow = undefined;
    if (previous && !previous.isDestroyed()) {
      previous.destroy();
    }
    this.createOverlayWindow();
  }

  private createOverlayWindow(): void {
    const display = screen.getPrimaryDisplay();
    const overlay = new BrowserWindow({
      x: display.bounds.x,
      y: display.bounds.y,
      width: display.bounds.width,
      height: display.bounds.height,
      ...(process.platform === "darwin" ? { type: "panel" } : {}),
      frame: false,
      transparent: true,
      resizable: false,
      movable: false,
      focusable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      hasShadow: false,
      show: false,
      fullscreenable: false,
      backgroundColor: "#00000000",
      webPreferences: secureWebPreferences(),
    });
    this.overlayWindow = overlay;
    this.overlayFullscreenSpacesConfigured = false;

    guardNavigation(overlay.webContents);
    // No { forward: true }: on Windows that installs a global low-level mouse hook, and the
    // overlay never handles mouse input.
    overlay.setIgnoreMouseEvents(true);
    this.applyOverlayCaptureExclusion();

    overlay.webContents.on("render-process-gone", (_event, details) => {
      if (this.overlayWindow === overlay) {
        this.scheduleOverlayRecovery(`renderer ${details.reason}`);
      }
    });
    overlay.on("closed", () => {
      if (this.overlayWindow === overlay) {
        this.overlayWindow = undefined;
      }
    });

    void this.loadView(overlay, "overlay")
      .then(() => {
        if (this.overlayVisible && this.overlayWindow === overlay) {
          this.showOverlayWindow();
        }
      })
      .catch((error: unknown) => console.error("Failed to load the overlay.", error));
  }

  /**
   * Hide the overlay from screen capture (our own screenshots included) so the model does not
   * read its previous danmaku. Only applied where it does not black out the capture instead.
   */
  private applyOverlayCaptureExclusion(): void {
    const overlay = this.liveOverlay();
    if (!overlay || (process.platform !== "win32" && process.platform !== "darwin")) {
      return;
    }

    const supported = supportsCaptureExclusion(process.platform, os.release());
    if (this.excludeOverlayFromCapture && !supported && !this.captureExclusionWarned) {
      this.captureExclusionWarned = true;
      console.warn(
        `Excluding the overlay from screen capture needs Windows 10 2004 or later (this is ${os.release()}); danmaku will appear in screenshots.`,
      );
    }

    const enabled = this.excludeOverlayFromCapture && supported;
    if (overlay.isContentProtected() !== enabled) {
      overlay.setContentProtection(enabled);
    }
  }

  private showOverlayWindow(): void {
    const overlay = this.liveOverlay();
    if (!overlay) {
      return;
    }

    this.fitOverlayToPrimaryDisplay();
    overlay.showInactive();
    this.applyOverlayWindowLevel(true);
  }

  private applyOverlayWindowLevel(configureFullscreenSpaces = false): void {
    const overlay = this.liveOverlay();
    if (!overlay) {
      return;
    }

    overlay.setAlwaysOnTop(true, "screen-saver", 1);
    overlay.moveTop();

    if (
      process.platform === "darwin" &&
      configureFullscreenSpaces &&
      !this.overlayFullscreenSpacesConfigured
    ) {
      overlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
      this.overlayFullscreenSpacesConfigured = true;
      app.dock?.show();
    }
  }

  private fitOverlayToPrimaryDisplay(): void {
    const overlay = this.liveOverlay();
    if (!overlay) {
      return;
    }

    const { bounds } = screen.getPrimaryDisplay();
    if (!sameBounds(overlay.getBounds(), bounds)) {
      overlay.setBounds(bounds);
    }
  }

  private async loadView(window: BrowserWindow, view: "settings" | "overlay"): Promise<void> {
    const devUrl = process.env.VITE_DEV_SERVER_URL;
    if (devUrl) {
      await window.loadURL(`${devUrl}?view=${view}`);
      return;
    }

    await window.loadFile(rendererIndexPath(), {
      query: { view },
    });
  }

  private registerShortcuts(): void {
    const shortcuts: Array<[accelerator: string, action: () => void]> = [
      [
        "CommandOrControl+Alt+D",
        () => {
          if (this.latestStatus.state === "running") {
            void this.controller?.stop();
          } else {
            void this.controller?.start();
          }
        },
      ],
      [
        "CommandOrControl+Alt+Space",
        () => {
          void this.controller?.generateOnce("manual");
        },
      ],
    ];

    const failed = shortcuts
      .filter(([accelerator, action]) => !globalShortcut.register(accelerator, action))
      .map(([accelerator]) => accelerator);
    if (failed.length === 0) {
      return;
    }

    this.failedShortcuts = failed.map((accelerator) =>
      formatAccelerator(accelerator, process.platform),
    );
    console.warn(`Global shortcuts already in use by another program: ${failed.join(", ")}`);
    const notice = `快捷键 ${this.failedShortcuts.join("、")} 注册失败，可能已被其他程序占用`;
    setTimeout(() => this.controller?.pushSystemMessage(notice), SHORTCUT_NOTICE_DELAY_MS);
  }

  private updateTrayMenu(): void {
    if (!this.tray) {
      return;
    }

    const running = this.latestStatus.state === "running";
    const template = Menu.buildFromTemplate([
      {
        label: "Open Settings",
        click: () => this.showSettings(),
      },
      {
        label: running ? "Pause" : "Start",
        click: () => {
          if (running) {
            void this.controller?.stop();
          } else {
            void this.controller?.start();
          }
        },
      },
      {
        label: "Generate Once",
        click: () => {
          void this.controller?.generateOnce("manual");
        },
      },
      {
        label: "Clear Overlay",
        click: () => this.controller?.clearOverlay(),
      },
      { type: "separator" },
      {
        label: "Quit",
        click: () => app.quit(),
      },
    ]);

    this.tray.setContextMenu(template);
  }
}
