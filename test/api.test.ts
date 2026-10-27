/// <reference path="../src/renderer/vite-env.d.ts" />
import { afterEach, describe, expect, it, vi } from "vitest";
import { BRIDGE_MISSING_MESSAGE, api, isElectronUserAgent } from "../src/renderer/api";
import type { DanmakuBridge, RuntimeStatus } from "../src/shared/types";

const ELECTRON_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) danmaku-companion/0.1.27 Chrome/140.0.0.0 Electron/42.3.3 Safari/537.36";
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

function stubRenderer(userAgent: string, danmaku?: DanmakuBridge) {
  vi.stubGlobal("window", danmaku ? { danmaku } : {});
  vi.stubGlobal("navigator", { userAgent });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("isElectronUserAgent", () => {
  it("recognizes Electron renderers only", () => {
    expect(isElectronUserAgent(ELECTRON_UA)).toBe(true);
    expect(isElectronUserAgent(BROWSER_UA)).toBe(false);
  });
});

describe("api", () => {
  it("returns the preload bridge when it exists", () => {
    const bridge = {} as DanmakuBridge;
    stubRenderer(ELECTRON_UA, bridge);

    expect(api()).toBe(bridge);
  });

  it("refuses to fall back to the preview mock inside Electron", () => {
    stubRenderer(ELECTRON_UA);

    expect(() => api()).toThrow(BRIDGE_MISSING_MESSAGE);
    expect((window as { danmaku?: DanmakuBridge }).danmaku).toBeUndefined();
  });

  it("uses the preview mock in a plain browser and broadcasts generation status", async () => {
    stubRenderer(BROWSER_UA);
    const bridge = api();
    const statuses: RuntimeStatus[] = [];
    bridge.onRuntimeStatus((status) => statuses.push(status));

    await bridge.generateOnce();
    await bridge.generateOnce();

    expect(window.danmaku).toBe(bridge);
    expect(statuses.map((status) => status.cycles)).toEqual([1, 2]);
    expect(await bridge.getGenerationLogs()).toHaveLength(2);
  });
});
