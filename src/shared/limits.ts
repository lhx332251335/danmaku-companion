export interface NumericRange {
  min: number;
  max: number;
}

export const LIMITS = {
  intervalSeconds: { min: 5, max: 1800 },
  itemsPerCycle: { min: 1, max: 12 },
  releaseWindowSeconds: { min: 0, max: 60 },
  captureMaxEdgePixels: { min: 480, max: 2160 },
  captureJpegQuality: { min: 0.5, max: 0.95 },
  historyRounds: { min: 0, max: 50 },
  historyMaxImages: { min: 0, max: 50 },
  requestBodyLimitMB: { min: 1, max: 512 },
  generationLogLimit: { min: 10, max: 2000 },
  maxCommentLength: { min: 10, max: 200 },
  timeoutMs: { min: 5000, max: 600000 },
  maxTokens: { min: 16, max: 32768 },
} as const satisfies Record<string, NumericRange>;

export function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }

  return Math.min(max, Math.max(min, value));
}

export function clampToRange(value: number, range: NumericRange): number {
  return clamp(value, range.min, range.max);
}

/** Like clamp, but non-numeric or non-finite input falls back to `fallback` instead of the minimum. */
export function clampOr(value: unknown, range: NumericRange, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }

  return clampToRange(value, range);
}
