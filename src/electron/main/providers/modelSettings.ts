import type { AppConfig } from "../../../shared/types";
import { defaultAppConfig } from "../../../shared/defaultConfig";
import { LIMITS, clampToRange, type NumericRange } from "../../../shared/limits";

/** Empty, zero or non-numeric input (a cleared settings box) means "not set" and uses the default. */
function positiveSetting(value: unknown, range: NumericRange, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return fallback;
  }

  return Math.round(clampToRange(value, range));
}

export function normalizedTimeoutMs(config: AppConfig): number {
  return positiveSetting(config.model.timeoutMs, LIMITS.timeoutMs, defaultAppConfig.model.timeoutMs);
}

export function normalizedMaxTokens(config: AppConfig): number {
  return positiveSetting(config.model.maxTokens, LIMITS.maxTokens, defaultAppConfig.model.maxTokens);
}
