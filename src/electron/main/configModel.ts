import { randomUUID } from "node:crypto";
import { defaultAppConfig } from "../../shared/defaultConfig";
import type { AppConfig, DeepPartial } from "../../shared/types";

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
    if (value === undefined) {
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
  return normalizeConfig(deepMerge<AppConfig>(defaultAppConfig, patch));
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

export function stateFromParsed(value: unknown): ConfigState {
  if (isRecord(value) && Array.isArray(value.profiles)) {
    const now = new Date().toISOString();
    const profiles = value.profiles
      .map((entry, index): ConfigProfile | undefined => {
        if (!isRecord(entry)) {
          return undefined;
        }

        const id = cleanName(entry.id, randomUUID());
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
