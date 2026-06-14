import {
  BrowserWindow,
  Menu,
  Tray,
  app,
  globalShortcut,
  nativeImage,
  screen,
} from "electron";
import path from "node:path";
import type { AppConfig, RuntimeStatus } from "../../shared/types";
import type { DanmakuController } from "./danmakuController";

const trayIconSvg = Buffer.from(`
<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 18 18">
  <path fill="#000" d="M3 5.25h12v2H3zM1.75 10.75h8.25v2H1.75zM12 10.75h4.25v2H12z"/>
</svg>`);

export class WindowManager {
  private settingsWindow: BrowserWindow | undefined;
  private overlayWindow: BrowserWindow | undefined;
  private tray: Tray | undefined;
  private controller: DanmakuController | undefined;
  private latestStatus: RuntimeStatus = { state: "idle", cycles: 0 };
  private overlayVisible = true;
  private overlayFullscreenSpacesConfigured = false;

  setController(controller: DanmakuController): void {
    this.controller = controller;
  }

  createWindows(): void {
    this.createOverlayWindow();
    this.createSettingsWindow();
    this.registerShortcuts();
  }

  createTray(): void {
    const image = nativeImage.createFromDataURL(
      `data:image/svg+xml;base64,${trayIconSvg.toString("base64")}`,
    );
    image.setTemplateImage(true);
    this.tray = new Tray(image);
    if (process.platform === "darwin") {
      this.tray.setTitle("弹幕");
      app.dock?.show();
    }
    this.tray.setToolTip("Danmaku Companion");
    this.updateTrayMenu();
  }

  getOverlayWindow(): BrowserWindow | undefined {
    if (this.overlayVisible) {
      this.showOverlayWindow();
    }

    return this.overlayWindow;
  }

  broadcastStatus(status: RuntimeStatus): void {
    this.latestStatus = status;
    this.settingsWindow?.webContents.send("runtime:status", status);
    this.updateTrayMenu();
  }

  broadcastConfig(config: AppConfig): void {
    this.settingsWindow?.webContents.send("config:updated", config);
    this.overlayWindow?.webContents.send("config:updated", config);
  }

  setOverlayVisible(visible: boolean): void {
    this.overlayVisible = visible;

    if (!this.overlayWindow) {
      return;
    }

    if (visible) {
      this.showOverlayWindow();
    } else {
      this.overlayWindow.hide();
    }
  }

  sendOverlayClear(): void {
    this.overlayWindow?.webContents.send("overlay:clear");
  }

  prepareForQuit(): void {
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
      title: "Danmaku Companion",
      backgroundColor: "#f6f8fb",
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        preload: path.join(__dirname, "../preload/index.js"),
      },
    });

    void this.loadView(this.settingsWindow, "settings");

    this.settingsWindow.on("closed", () => {
      this.settingsWindow = undefined;
    });
  }

  private createOverlayWindow(): void {
    const display = screen.getPrimaryDisplay();
    this.overlayWindow = new BrowserWindow({
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
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        preload: path.join(__dirname, "../preload/index.js"),
      },
    });

    this.overlayWindow.setIgnoreMouseEvents(true, { forward: true });
    void this.loadView(this.overlayWindow, "overlay").then(() => {
      if (this.overlayVisible) {
        this.showOverlayWindow();
      }
    });

    screen.on("display-metrics-changed", () => this.fitOverlayToPrimaryDisplay());
    screen.on("display-added", () => this.fitOverlayToPrimaryDisplay());
    screen.on("display-removed", () => this.fitOverlayToPrimaryDisplay());

    this.overlayWindow.on("closed", () => {
      this.overlayWindow = undefined;
      this.overlayFullscreenSpacesConfigured = false;
    });
  }

  private showOverlayWindow(): void {
    const overlay = this.overlayWindow;
    if (!overlay || overlay.isDestroyed()) {
      return;
    }

    this.fitOverlayToPrimaryDisplay();
    overlay.showInactive();
    this.applyOverlayWindowLevel(true);
  }

  private applyOverlayWindowLevel(configureFullscreenSpaces = false): void {
    const overlay = this.overlayWindow;
    if (!overlay || overlay.isDestroyed()) {
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
    const overlay = this.overlayWindow;
    if (!overlay || overlay.isDestroyed()) {
      return;
    }

    const display = screen.getPrimaryDisplay();
    overlay.setBounds(display.bounds);
    this.applyOverlayWindowLevel();
  }

  private async loadView(window: BrowserWindow, view: "settings" | "overlay"): Promise<void> {
    const devUrl = process.env.VITE_DEV_SERVER_URL;
    if (devUrl) {
      await window.loadURL(`${devUrl}?view=${view}`);
      return;
    }

    const rendererIndex = app.isPackaged
      ? path.join(app.getAppPath(), "dist/renderer/index.html")
      : path.join(process.cwd(), "dist/renderer/index.html");

    await window.loadFile(rendererIndex, {
      query: { view },
    });
  }

  private registerShortcuts(): void {
    globalShortcut.register("CommandOrControl+Alt+D", () => {
      if (this.latestStatus.state === "running") {
        void this.controller?.stop();
      } else {
        void this.controller?.start();
      }
    });

    globalShortcut.register("CommandOrControl+Alt+Space", () => {
      void this.controller?.generateOnce("manual");
    });
  }

  private updateTrayMenu(): void {
    if (!this.tray) {
      return;
    }

    const running = this.latestStatus.state === "running";
    const template = Menu.buildFromTemplate([
      {
        label: "Open Settings",
        click: () => {
          if (!this.settingsWindow) {
            this.createSettingsWindow();
          }
          this.settingsWindow?.show();
          this.settingsWindow?.focus();
        },
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
        click: () => this.sendOverlayClear(),
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
