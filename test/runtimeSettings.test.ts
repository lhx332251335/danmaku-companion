import { describe, expect, it } from "vitest";
import {
  normalizeRuntimeSettings,
  randomReleaseWindowSeconds,
  releaseDelays,
} from "../src/electron/main/runtime/runtimeSettings";
import { makeConfig } from "./helpers";

describe("normalizeRuntimeSettings", () => {
  it("orders and clamps ranges", () => {
    const settings = normalizeRuntimeSettings(
      makeConfig({
        runtime: {
          intervalMinSeconds: 9000,
          intervalMaxSeconds: 1,
          itemsPerCycle: 99,
          releaseWindowMinSeconds: 30,
          releaseWindowMaxSeconds: 2,
          captureMaxEdgePixels: 100,
          captureJpegQuality: 2,
          historyRounds: 3.6,
          generationLogLimit: Number.NaN,
        },
      }),
    );
    expect(settings).toMatchObject({
      intervalMinSeconds: 5,
      intervalMaxSeconds: 1800,
      itemsPerCycle: 12,
      releaseWindowMinSeconds: 2,
      releaseWindowMaxSeconds: 30,
      captureMaxEdgePixels: 480,
      captureJpegQuality: 0.95,
      historyRounds: 4,
      generationLogLimit: 10,
      captureImageFormat: "jpeg",
    });
  });
});

describe("release timing", () => {
  it("spreads items across equal segments of the window", () => {
    expect(releaseDelays(4, 8, () => 0.5)).toEqual([1000, 3000, 5000, 7000]);
    expect(releaseDelays(0, 8)).toEqual([]);
    expect(releaseDelays(2, 0, () => 0.9)).toEqual([0, 0]);
  });

  it("returns 0 for a closed window", () => {
    expect(randomReleaseWindowSeconds(0, 0)).toBe(0);
    expect(randomReleaseWindowSeconds(6, 10, () => 0.5)).toBe(8);
  });
});
