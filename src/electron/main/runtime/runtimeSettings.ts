import type { AppConfig, HistoryMode, ScreenImageFormat } from "../../../shared/types";
import { LIMITS, clamp, clampOr, clampToRange } from "../../../shared/limits";

export interface NormalizedRuntimeSettings {
  intervalMinSeconds: number;
  intervalMaxSeconds: number;
  startDelaySeconds: number;
  itemsPerCycle: number;
  releaseWindowMinSeconds: number;
  releaseWindowMaxSeconds: number;
  captureShortEdgePixels: number;
  captureImageFormat: ScreenImageFormat;
  captureJpegQuality: number;
  historyRounds: number;
  historyMode: HistoryMode;
  historyIncludeImages: boolean;
  historyMaxImages: number;
  requestBodyLimitBytes: number;
  historySummaryEnabled: boolean;
  historySummaryMaxChars: number;
  generationLogLimit: number;
}

const HISTORY_MODES: readonly HistoryMode[] = ["reset-on-limit", "sliding", "batch-sliding"];
const MIB = 1024 * 1024;
const DEFAULT_HISTORY_MAX_IMAGES = 24;
const DEFAULT_START_DELAY_SECONDS = 5;
const DEFAULT_HISTORY_SUMMARY_MAX_CHARS = 400;
const DEFAULT_REQUEST_BODY_LIMIT_MB = 48;

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
    startDelaySeconds: clampOr(runtime.startDelaySeconds, LIMITS.startDelaySeconds, DEFAULT_START_DELAY_SECONDS),
    itemsPerCycle: Math.round(clampToRange(rawItemsPerCycle, LIMITS.itemsPerCycle)),
    releaseWindowMinSeconds,
    releaseWindowMaxSeconds,
    captureShortEdgePixels: Math.round(
      clampToRange(runtime.captureShortEdgePixels, LIMITS.captureShortEdgePixels),
    ),
    captureImageFormat: runtime.captureImageFormat === "png" ? "png" : "jpeg",
    captureJpegQuality: clampToRange(runtime.captureJpegQuality, LIMITS.captureJpegQuality),
    historyRounds: Math.round(clampToRange(runtime.historyRounds, LIMITS.historyRounds)),
    historyMode: HISTORY_MODES.includes(runtime.historyMode) ? runtime.historyMode : "reset-on-limit",
    historyIncludeImages: Boolean(runtime.historyIncludeImages),
    historyMaxImages: Math.round(
      clampOr(runtime.historyMaxImages, LIMITS.historyMaxImages, DEFAULT_HISTORY_MAX_IMAGES),
    ),
    historySummaryEnabled: Boolean(runtime.historySummaryEnabled),
    historySummaryMaxChars: Math.round(
      clampOr(runtime.historySummaryMaxChars, LIMITS.historySummaryMaxChars, DEFAULT_HISTORY_SUMMARY_MAX_CHARS),
    ),
    requestBodyLimitBytes: Math.round(
      clampOr(runtime.requestBodyLimitMB, LIMITS.requestBodyLimitMB, DEFAULT_REQUEST_BODY_LIMIT_MB) * MIB,
    ),
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

export type CycleInterval = Pick<NormalizedRuntimeSettings, "intervalMinSeconds" | "intervalMaxSeconds">;

/** An armed cycle timer: the interval it was drawn from and when it fires (epoch ms). */
export interface ArmedCycle extends CycleInterval {
  dueAt: number;
}

export function cycleDelayMs(interval: CycleInterval, random: RandomSource = Math.random): number {
  return Math.round(randomBetween(interval.intervalMinSeconds, interval.intervalMaxSeconds, random) * 1000);
}

/**
 * Delay to re-arm the cycle timer with after a config save, or undefined to leave it alone.
 * Only an interval change re-arms it, and never later than it was already due.
 */
export function rescheduledDelayMs(
  armed: ArmedCycle,
  interval: CycleInterval,
  now: number,
  random: RandomSource = Math.random,
): number | undefined {
  if (
    armed.intervalMinSeconds === interval.intervalMinSeconds &&
    armed.intervalMaxSeconds === interval.intervalMaxSeconds
  ) {
    return undefined;
  }

  return Math.min(Math.max(0, armed.dueAt - now), cycleDelayMs(interval, random));
}
