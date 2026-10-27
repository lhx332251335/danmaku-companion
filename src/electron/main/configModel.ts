import { randomUUID } from "node:crypto";
import { defaultAppConfig } from "../../shared/defaultConfig";
import { LIMITS, clampToRange, type NumericRange } from "../../shared/limits";
import type {
  AppConfig,
  DanmakuZone,
  DeepPartial,
  HistoryMode,
  ProviderKind,
  ScreenImageFormat,
} from "../../shared/types";

export interface ConfigProfile {
  id: string;
  name: string;
  config: AppConfig;
  createdAt: string;
  updatedAt: string;
}

export interface ConfigState {
  activeProfileId: string;
  profiles: ConfigProfile[];
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function deepMerge<T>(base: T, patch: DeepPartial<T>): T {
  const output: Record<string, unknown> = { ...(base as Record<string, unknown>) };

  for (const [key, value] of Object.entries(patch as Record<string, unknown>)) {
    if (value === undefined || value === null) {
      continue;
    }

    const current = output[key];
    output[key] =
      isRecord(current) && isRecord(value)
        ? deepMerge(current, value as DeepPartial<typeof current>)
        : value;
  }

  return output as T;
}

export function cloneConfig(config: AppConfig): AppConfig {
  return JSON.parse(JSON.stringify(config)) as AppConfig;
}

interface NumberRule {
  range: NumericRange;
  integer?: boolean;
}

type SectionKey = "model" | "danmaku" | "runtime";
type KeysOfType<T, V> = { [K in keyof T]: T[K] extends V ? K & string : never }[keyof T];
type SectionPath<V> = { [S in SectionKey]: `${S}.${KeysOfType<AppConfig[S], V>}` }[SectionKey];

const NUMBER_RULES: Readonly<Partial<Record<SectionPath<number>, NumberRule>>> = {
  "model.temperature": { range: LIMITS.temperature },
  "model.maxTokens": { range: LIMITS.maxTokens, integer: true },
  "model.timeoutMs": { range: LIMITS.timeoutMs, integer: true },
  "danmaku.fontSize": { range: LIMITS.fontSize },
  "danmaku.opacity": { range: LIMITS.opacity },
  "danmaku.speedSeconds": { range: LIMITS.speedSeconds },
  "danmaku.maxCommentLength": { range: LIMITS.maxCommentLength, integer: true },
  "danmaku.density": { range: LIMITS.density },
  "runtime.intervalMinSeconds": { range: LIMITS.intervalSeconds },
  "runtime.intervalMaxSeconds": { range: LIMITS.intervalSeconds },
  "runtime.intervalSeconds": { range: LIMITS.intervalSeconds },
  "runtime.itemsPerCycle": { range: LIMITS.itemsPerCycle, integer: true },
  "runtime.itemsMinPerCycle": { range: LIMITS.itemsPerCycle, integer: true },
  "runtime.itemsMaxPerCycle": { range: LIMITS.itemsPerCycle, integer: true },
  "runtime.maxItemsPerCycle": { range: LIMITS.itemsPerCycle, integer: true },
  "runtime.releaseWindowMinSeconds": { range: LIMITS.releaseWindowSeconds },
  "runtime.releaseWindowMaxSeconds": { range: LIMITS.releaseWindowSeconds },
  "runtime.releaseWindowSeconds": { range: LIMITS.releaseWindowSeconds },
  "runtime.captureMaxEdgePixels": { range: LIMITS.captureMaxEdgePixels, integer: true },
  "runtime.captureJpegQuality": { range: LIMITS.captureJpegQuality },
  "runtime.historyRounds": { range: LIMITS.historyRounds, integer: true },
  "runtime.historyMaxImages": { range: LIMITS.historyMaxImages, integer: true },
  "runtime.requestBodyLimitMB": { range: LIMITS.requestBodyLimitMB },
  "runtime.generationLogLimit": { range: LIMITS.generationLogLimit, integer: true },
};

function enumValues<T extends string>(values: Record<T, true>): readonly string[] {
  return Object.keys(values);
}

const ENUM_RULES: Readonly<Partial<Record<SectionPath<string>, readonly string[]>>> = {
  "model.provider": enumValues<ProviderKind>({ "openai-compatible": true }),
  "danmaku.zone": enumValues<DanmakuZone>({ full: true, top: true, middle: true, bottom: true }),
  "runtime.captureImageFormat": enumValues<ScreenImageFormat>({ jpeg: true, png: true }),
  "runtime.historyMode": enumValues<HistoryMode>({
    "reset-on-limit": true,
    sliding: true,
    "batch-sliding": true,
  }),
};

const NON_EMPTY_LISTS: ReadonlySet<string> = new Set(["danmaku.palette"]);

function sameKind(value: unknown, schema: unknown): boolean {
  if (isRecord(schema)) {
    return isRecord(value);
  }
  if (Array.isArray(schema)) {
    return Array.isArray(value);
  }
  return typeof value === typeof schema;
}

function sanitizeNumber(value: unknown, fallback: number, rule: NumberRule | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  if (!rule) {
    return value;
  }

  const clamped = clampToRange(value, rule.range);
  return rule.integer ? Math.round(clamped) : clamped;
}

function sanitizeString(value: unknown, fallback: string, allowed: readonly string[] | undefined): string {
  if (typeof value !== "string" || (allowed && !allowed.includes(value))) {
    return fallback;
  }
  return value;
}

function sanitizeStringList(value: unknown, fallback: string[], requireItems: boolean): string[] {
  const items = Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
  return Array.isArray(value) && (items.length > 0 || !requireItems) ? items : [...fallback];
}

function sanitizeValue(value: unknown, schema: unknown, fallback: unknown, path: string): unknown {
  const base = sameKind(fallback, schema) ? fallback : schema;

  if (isRecord(schema)) {
    const source = isRecord(value) ? value : {};
    const baseRecord = base as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(schema).map(([key, child]) => [
        key,
        sanitizeValue(source[key], child, baseRecord[key], path ? `${path}.${key}` : key),
      ]),
    );
  }
  if (Array.isArray(schema)) {
    return sanitizeStringList(value, base as string[], NON_EMPTY_LISTS.has(path));
  }
  if (typeof schema === "number") {
    return sanitizeNumber(value, base as number, NUMBER_RULES[path as SectionPath<number>]);
  }
  if (typeof schema === "string") {
    return sanitizeString(value, base as string, ENUM_RULES[path as SectionPath<string>]);
  }
  return typeof value === typeof schema ? value : base;
}

/**
 * Rebuilds a config from the shape of defaultAppConfig: unknown keys are dropped, values of the
 * wrong type or outside an enum fall back to `fallback`, and numbers are clamped to LIMITS.
 * `fallback` must itself be a sanitized config.
 */
export function sanitizeConfig(value: unknown, fallback: AppConfig = defaultAppConfig): AppConfig {
  return sanitizeValue(value, defaultAppConfig, fallback, "") as AppConfig;
}

/** Merges an untrusted patch into a config without letting it break the config's shape. */
export function applyConfigPatch(config: AppConfig, patch: unknown): AppConfig {
  const merged = deepMerge<AppConfig>(config, isRecord(patch) ? patch : {});
  return normalizeConfig(sanitizeConfig(merged, config));
}

/** runtime.enabled is owned by the main process; renderer patches must not overwrite it. */
export function stripRunFlag(patch: unknown): DeepPartial<AppConfig> {
  if (!isRecord(patch)) {
    return {};
  }
  if (!isRecord(patch.runtime) || !("enabled" in patch.runtime)) {
    return patch as DeepPartial<AppConfig>;
  }

  const { enabled: _enabled, ...runtime } = patch.runtime;
  return { ...patch, runtime } as DeepPartial<AppConfig>;
}

export function withRunFlag(config: AppConfig, enabled: boolean): AppConfig {
  return config.runtime.enabled === enabled
    ? config
    : { ...config, runtime: { ...config.runtime, enabled } };
}

export function parseJson(raw: string): unknown {
  return JSON.parse(raw.replace(/^\uFEFF/, ""));
}

export function migrateParsedConfig(config: DeepPartial<AppConfig>): DeepPartial<AppConfig> {
  const runtime = config.runtime;
  if (
    runtime &&
    runtime.releaseWindowSeconds !== undefined &&
    runtime.releaseWindowMinSeconds === undefined &&
    runtime.releaseWindowMaxSeconds === undefined
  ) {
    runtime.releaseWindowMinSeconds = runtime.releaseWindowSeconds;
    runtime.releaseWindowMaxSeconds = runtime.releaseWindowSeconds;
  }

  return config;
}

const OLD_DEFAULT_USER_LINES = new Set([
  "Active app: {{activeApp}}",
  "Requested comments: {{requestedCount}}",
  "Recent comments: {{recentComments}}",
  "Return exactly {{requestedCount}} danmaku comments if possible.",
  "Return only JSON in this shape: {{jsonShape}}",
]);
const JSON_OUTPUT_INSTRUCTION = "Return only JSON in this shape: {{jsonShape}}";
const REQUESTED_COUNT_INSTRUCTION =
  "Return exactly {{requestedCount}} comments unless the model is unable to parse the request.";

export function normalizeConfig(config: AppConfig): AppConfig {
  const userLines = config.prompt.userTemplate.split(/\r?\n/);
  const migratedUserLines = userLines.filter(
    (line) => !OLD_DEFAULT_USER_LINES.has(line.trim()),
  );
  const userTemplateChanged = migratedUserLines.length !== userLines.length;
  let systemTemplate = config.prompt.systemTemplate;
  if (
    userTemplateChanged &&
    userLines.some((line) => line.trim() === JSON_OUTPUT_INSTRUCTION) &&
    !systemTemplate.includes(JSON_OUTPUT_INSTRUCTION)
  ) {
    systemTemplate = `${systemTemplate.trimEnd()}\n${JSON_OUTPUT_INSTRUCTION}`;
  }
  if (
    !systemTemplate.includes("{{requestedCount}}") &&
    !systemTemplate.includes("requestedCount")
  ) {
    systemTemplate = `${systemTemplate.trimEnd()}\n${REQUESTED_COUNT_INSTRUCTION}`;
  }

  if (!userTemplateChanged && systemTemplate === config.prompt.systemTemplate) {
    return config;
  }

  return {
    ...config,
    prompt: {
      ...config.prompt,
      systemTemplate,
      userTemplate: migratedUserLines.join("\n").trim(),
    },
  };
}

export function isConfigLike(value: unknown): value is DeepPartial<AppConfig> {
  return (
    isRecord(value) &&
    ("model" in value ||
      "character" in value ||
      "user" in value ||
      "prompt" in value ||
      "danmaku" in value ||
      "runtime" in value)
  );
}

export function normalizeProfileConfig(value: unknown): AppConfig {
  const patch = isConfigLike(value) ? migrateParsedConfig(value) : {};
  return normalizeConfig(sanitizeConfig(patch));
}

export function cleanName(name: unknown, fallback: string): string {
  const trimmed = typeof name === "string" ? name.trim() : "";
  return trimmed || fallback;
}

export function timestamp(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value : fallback;
}

export function stateFromConfig(config: AppConfig, name = "默认配置"): ConfigState {
  const now = new Date().toISOString();
  const id = randomUUID();
  return {
    activeProfileId: id,
    profiles: [
      {
        id,
        name,
        config,
        createdAt: now,
        updatedAt: now,
      },
    ],
  };
}

/** A hand-edited file may repeat an id; deleting it would then remove every copy at once. */
function uniqueProfileId(value: unknown, usedIds: Set<string>): string {
  const cleaned = cleanName(value, "");
  const id = cleaned && !usedIds.has(cleaned) ? cleaned : randomUUID();
  usedIds.add(id);
  return id;
}

export function stateFromParsed(value: unknown): ConfigState {
  if (isRecord(value) && Array.isArray(value.profiles)) {
    const now = new Date().toISOString();
    const usedIds = new Set<string>();
    const profiles = value.profiles
      .map((entry, index): ConfigProfile | undefined => {
        if (!isRecord(entry)) {
          return undefined;
        }

        const id = uniqueProfileId(entry.id, usedIds);
        return {
          id,
          name: cleanName(entry.name, `配置 ${index + 1}`),
          config: normalizeProfileConfig(entry.config),
          createdAt: timestamp(entry.createdAt, now),
          updatedAt: timestamp(entry.updatedAt, now),
        };
      })
      .filter((profile): profile is ConfigProfile => Boolean(profile));

    if (profiles.length > 0) {
      const activeProfileId =
        typeof value.activeProfileId === "string" &&
        profiles.some((profile) => profile.id === value.activeProfileId)
          ? value.activeProfileId
          : profiles[0].id;

      return { activeProfileId, profiles };
    }
  }

  return stateFromConfig(normalizeProfileConfig(value));
}

export function serializableState(state: ConfigState): Record<string, unknown> {
  return {
    version: 2,
    activeProfileId: state.activeProfileId,
    profiles: state.profiles,
  };
}

export function serializeState(state: ConfigState): string {
  return `${JSON.stringify(serializableState(state), null, 2)}\n`;
}

function isStoredState(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }
  return Array.isArray(value.profiles) ? value.profiles.some(isRecord) : isConfigLike(value);
}

/** Parses config.json text; undefined means it is not JSON or holds nothing recognizable. */
export function stateFromText(raw: string): ConfigState | undefined {
  let value: unknown;
  try {
    value = parseJson(raw);
  } catch {
    return undefined;
  }
  return isStoredState(value) ? stateFromParsed(value) : undefined;
}
