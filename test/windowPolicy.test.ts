import { describe, expect, it } from "vitest";
import { normalizeProfileConfig } from "../src/electron/main/configModel";
import {
  OVERLAY_RECOVERY_MAX_ATTEMPTS,
  OVERLAY_RECOVERY_WINDOW_MS,
  OVERLAY_TOPMOST_REFRESH_MS,
  formatAccelerator,
  isAppUrl,
  overlayRecoveryDelay,
  recordOverlayCrash,
  sameBounds,
  shouldRefreshTopmost,
  supportsCaptureExclusion,
  windowsBuildNumber,
} from "../src/electron/main/windowPolicy";
import { defaultAppConfig } from "../src/shared/defaultConfig";

describe("isAppUrl", () => {
  const fileEntry = "file:///C:/Program%20Files/Danmaku%20Companion/resources/app/dist/renderer/index.html";

  it("allows the packaged renderer page with any query or hash", () => {
    expect(isAppUrl(`${fileEntry}?view=settings`, fileEntry)).toBe(true);
    expect(isAppUrl(`${fileEntry}?view=overlay#top`, fileEntry)).toBe(true);
  });

  it("blocks other local files, such as a dropped .html file", () => {
    expect(isAppUrl("file:///C:/Users/me/Downloads/page.html", fileEntry)).toBe(false);
    expect(isAppUrl("file:///C:/Program%20Files/Danmaku%20Companion/resources/app/dist/renderer/other.html", fileEntry)).toBe(false);
    expect(isAppUrl("file://evil-host/C:/Program%20Files/Danmaku%20Companion/resources/app/dist/renderer/index.html", fileEntry)).toBe(false);
  });

  it("blocks remote pages and script URLs", () => {
    expect(isAppUrl("https://example.com/", fileEntry)).toBe(false);
    expect(isAppUrl("javascript:alert(1)", fileEntry)).toBe(false);
    expect(isAppUrl("not a url", fileEntry)).toBe(false);
  });

  it("allows only the dev server origin in development", () => {
    const devEntry = "http://127.0.0.1:5173";
    expect(isAppUrl("http://127.0.0.1:5173/?view=settings", devEntry)).toBe(true);
    expect(isAppUrl("http://127.0.0.1:5174/?view=settings", devEntry)).toBe(false);
    expect(isAppUrl("http://localhost:5173/", devEntry)).toBe(false);
    expect(isAppUrl("https://127.0.0.1:5173/", devEntry)).toBe(false);
    expect(isAppUrl(`${fileEntry}?view=settings`, devEntry)).toBe(false);
  });
});

describe("supportsCaptureExclusion", () => {
  it("reads the Windows build number from os.release()", () => {
    expect(windowsBuildNumber("10.0.19045")).toBe(19045);
    expect(windowsBuildNumber("6.1.7601")).toBe(7601);
    expect(windowsBuildNumber("10.0")).toBeUndefined();
    expect(windowsBuildNumber("")).toBeUndefined();
  });

  it("needs Windows 10 2004 (build 19041) or later, where the overlay is removed instead of blacked out", () => {
    expect(supportsCaptureExclusion("win32", "10.0.18363")).toBe(false);
    expect(supportsCaptureExclusion("win32", "10.0.19041")).toBe(true);
    expect(supportsCaptureExclusion("win32", "10.0.22631")).toBe(true);
    expect(supportsCaptureExclusion("win32", "6.3.9600")).toBe(false);
    expect(supportsCaptureExclusion("win32", "unknown")).toBe(false);
  });

  it("is used on macOS and never on Linux", () => {
    expect(supportsCaptureExclusion("darwin", "24.0.0")).toBe(true);
    expect(supportsCaptureExclusion("linux", "6.8.0")).toBe(false);
  });

  it("is on by default, also for configs saved before the option existed", () => {
    expect(defaultAppConfig.danmaku.excludeOverlayFromCapture).toBe(true);
    const saved = { danmaku: { fontSize: 30 } };
    expect(normalizeProfileConfig(saved).danmaku.excludeOverlayFromCapture).toBe(true);
    const optedOut = { danmaku: { excludeOverlayFromCapture: false } };
    expect(normalizeProfileConfig(optedOut).danmaku.excludeOverlayFromCapture).toBe(false);
  });
});

describe("formatAccelerator", () => {
  it("names the platform modifier", () => {
    expect(formatAccelerator("CommandOrControl+Alt+D", "win32")).toBe("Ctrl+Alt+D");
    expect(formatAccelerator("CmdOrCtrl+Alt+Space", "linux")).toBe("Ctrl+Alt+Space");
    expect(formatAccelerator("CommandOrControl+Alt+D", "darwin")).toBe("Cmd+Alt+D");
  });
});

describe("overlay upkeep", () => {
  it("re-asserts topmost at most once per refresh interval", () => {
    expect(shouldRefreshTopmost(undefined, 1000)).toBe(true);
    expect(shouldRefreshTopmost(1000, 1000 + OVERLAY_TOPMOST_REFRESH_MS - 1)).toBe(false);
    expect(shouldRefreshTopmost(1000, 1000 + OVERLAY_TOPMOST_REFRESH_MS)).toBe(true);
  });

  it("compares window bounds", () => {
    const bounds = { x: 0, y: 0, width: 1280, height: 720 };
    expect(sameBounds(bounds, { ...bounds })).toBe(true);
    expect(sameBounds(bounds, { ...bounds, x: -1920 })).toBe(false);
    expect(sameBounds(bounds, { ...bounds, height: 680 })).toBe(false);
  });
});

describe("overlay crash recovery", () => {
  it("backs off with each recent crash and forgets old ones", () => {
    let crashes = recordOverlayCrash([], 0);
    expect(overlayRecoveryDelay(crashes)).toBe(500);
    crashes = recordOverlayCrash(crashes, 1000);
    expect(overlayRecoveryDelay(crashes)).toBe(1000);
    crashes = recordOverlayCrash(crashes, 2000);
    expect(overlayRecoveryDelay(crashes)).toBe(2000);

    const later = recordOverlayCrash(crashes, 2000 + OVERLAY_RECOVERY_WINDOW_MS);
    expect(later).toEqual([2000 + OVERLAY_RECOVERY_WINDOW_MS]);
    expect(overlayRecoveryDelay(later)).toBe(500);
  });

  it("gives up when the overlay keeps crashing", () => {
    let crashes: number[] = [];
    for (let index = 0; index < OVERLAY_RECOVERY_MAX_ATTEMPTS; index += 1) {
      crashes = recordOverlayCrash(crashes, index * 100);
      expect(overlayRecoveryDelay(crashes)).toBeGreaterThan(0);
    }
    crashes = recordOverlayCrash(crashes, OVERLAY_RECOVERY_MAX_ATTEMPTS * 100);
    expect(overlayRecoveryDelay(crashes)).toBeUndefined();
  });
});
