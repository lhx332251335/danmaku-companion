import type { AppConfig, HistoryMode, ScreenImageFormat } from "../../../shared/types";
import { LIMITS, clamp, clampToRange } from "../../../shared/limits";

export interface NormalizedRuntimeSettings {
  intervalMinSeconds: number;
  intervalMaxSeconds: number;
  itemsPerCycle: number;
  releaseWindowMinSeconds: number;
  releaseWindowMaxSeconds: number;
  captureMaxEdgePixels: number;
  captureImageFormat: ScreenImageFormat;
  captureJpegQuality: number;
  historyRounds: number;
  historyMode: HistoryMode;
  historyIncludeImages: boolean;
  generationLogLimit: number;
}

export type RandomSource = () => number;

export function randomBetween(min: number, max: number, random: RandomSource = Math.random): number {
  return min + random() * (max - min);
}

function orderedRange(
  rawMin: number,
  rawMax: number,
  range: { min: number; max: number },
): [number, number] {
  return [
    clamp(Math.min(rawMin, rawMax), range.min, range.max),
    clamp(Math.max(rawMin, rawMax), range.min, range.max),
  ];
}

export function normalizeRuntimeSettings(config: AppConfig): NormalizedRuntimeSettings {
  const runtime = config.runtime;
  const [intervalMinSeconds, intervalMaxSeconds] = orderedRange(
    runtime.intervalMinSeconds ?? runtime.intervalSeconds,
    runtime.intervalMaxSeconds ?? runtime.intervalSeconds,
    LIMITS.intervalSeconds,
  );
  const rawItemsPerCycle =
    runtime.itemsPerCycle ?? runtime.itemsMaxPerCycle ?? runtime.itemsMinPerCycle;
  const [releaseWindowMinSeconds, releaseWindowMaxSeconds] = orderedRange(
    runtime.releaseWindowMinSeconds ?? runtime.releaseWindowSeconds,
    runtime.releaseWindowMaxSeconds ?? runtime.releaseWindowSeconds,
    LIMITS.releaseWindowSeconds,
  );

  return {
    intervalMinSeconds,
    intervalMaxSeconds,
    itemsPerCycle: Math.round(clampToRange(rawItemsPerCycle, LIMITS.itemsPerCycle)),
    releaseWindowMinSeconds,
    releaseWindowMaxSeconds,
    captureMaxEdgePixels: Math.round(
      clampToRange(runtime.captureMaxEdgePixels, LIMITS.captureMaxEdgePixels),
    ),
    captureImageFormat: runtime.captureImageFormat === "png" ? "png" : "jpeg",
    captureJpegQuality: clampToRange(runtime.captureJpegQuality, LIMITS.captureJpegQuality),
    historyRounds: Math.round(clampToRange(runtime.historyRounds, LIMITS.historyRounds)),
    historyMode: runtime.historyMode ?? "reset-on-limit",
    historyIncludeImages: Boolean(runtime.historyIncludeImages),
    generationLogLimit: Math.round(
      clampToRange(runtime.generationLogLimit, LIMITS.generationLogLimit),
    ),
  };
}

export function releaseDelays(
  count: number,
  releaseWindowSeconds: number,
  random: RandomSource = Math.random,
): number[] {
  if (count <= 0) {
    return [];
  }

  const releaseWindowMs = releaseWindowSeconds * 1000;
  if (releaseWindowMs <= 0 || count === 1) {
    return Array.from({ length: count }, () =>
      Math.round(randomBetween(0, releaseWindowMs, random)),
    );
  }

  const segmentMs = releaseWindowMs / count;
  return Array.from({ length: count }, (_item, index) => {
    const segmentStart = index * segmentMs;
    return Math.round(
      Math.min(releaseWindowMs, segmentStart + randomBetween(0, segmentMs, random)),
    );
  });
}

export function randomReleaseWindowSeconds(
  minSeconds: number,
  maxSeconds: number,
  random: RandomSource = Math.random,
): number {
  if (maxSeconds <= 0) {
    return 0;
  }

  return randomBetween(minSeconds, maxSeconds, random);
}
