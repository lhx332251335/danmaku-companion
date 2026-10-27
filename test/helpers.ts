import { defaultAppConfig } from "../src/shared/defaultConfig";
import type { AppConfig, DeepPartial, ScreenSnapshot } from "../src/shared/types";

type Patch = DeepPartial<AppConfig>;

function merge(base: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
  const output = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    const current = output[key];
    output[key] =
      value && typeof value === "object" && !Array.isArray(value) && current && typeof current === "object"
        ? merge(current as Record<string, unknown>, value as Record<string, unknown>)
        : value;
  }
  return output;
}

export function makeConfig(patch: Patch = {}): AppConfig {
  return merge(structuredClone(defaultAppConfig) as never, patch as never) as unknown as AppConfig;
}

export function makeSnapshot(dataUrlBytes = 1000, overrides: Partial<ScreenSnapshot> = {}): ScreenSnapshot {
  const prefix = "data:image/jpeg;base64,";
  const dataUrl = `${prefix}${"A".repeat(Math.max(0, dataUrlBytes - prefix.length))}`;
  return {
    dataUrl,
    width: 960,
    height: 540,
    format: "jpeg",
    mediaType: "image/jpeg",
    imageBytes: Math.round((dataUrlBytes * 3) / 4),
    dataUrlBytes: dataUrl.length,
    jpegQuality: 0.82,
    capturedAt: "2026-01-01T00:00:00.000Z",
    sourceName: "test",
    ...overrides,
  };
}
