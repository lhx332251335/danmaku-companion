import { app } from "electron";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { defaultAppConfig } from "../../shared/defaultConfig";
import type {
  AppConfig,
  ConfigProfileResult,
  ConfigProfilesSnapshot,
  DeepPartial,
} from "../../shared/types";

interface ConfigProfile {
  id: string;
  name: string;
  config: AppConfig;
  createdAt: string;
  updatedAt: string;
}

interface ConfigState {
  activeProfileId: string;
  profiles: ConfigProfile[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function deepMerge<T>(base: T, patch: DeepPartial<T>): T {
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

function cloneConfig(config: AppConfig): AppConfig {
  return JSON.parse(JSON.stringify(config)) as AppConfig;
}

function parseJson(raw: string): unknown {
  return JSON.parse(raw.replace(/^\uFEFF/, ""));
}

function migrateParsedConfig(config: DeepPartial<AppConfig>): DeepPartial<AppConfig> {
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

function normalizeConfig(config: AppConfig): AppConfig {
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

function isConfigLike(value: unknown): value is DeepPartial<AppConfig> {
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

function normalizeProfileConfig(value: unknown): AppConfig {
  const patch = isConfigLike(value) ? migrateParsedConfig(value) : {};
  return normalizeConfig(deepMerge<AppConfig>(defaultAppConfig, patch));
}

function cleanName(name: unknown, fallback: string): string {
  const trimmed = typeof name === "string" ? name.trim() : "";
  return trimmed || fallback;
}

function timestamp(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function stateFromConfig(config: AppConfig, name = "默认配置"): ConfigState {
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

function stateFromParsed(value: unknown): ConfigState {
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

function serializableState(state: ConfigState): Record<string, unknown> {
  return {
    version: 2,
    activeProfileId: state.activeProfileId,
    profiles: state.profiles,
  };
}

export class ConfigStore {
  private filePath: string | undefined;
  private state: ConfigState | undefined;

  private getFilePath(): string {
    this.filePath ??= path.join(app.getPath("userData"), "config.json");
    return this.filePath;
  }

  private getLegacyFilePath(): string {
    return path.join(app.getPath("appData"), "Electron", "config.json");
  }

  async get(): Promise<AppConfig> {
    const state = await this.getState();
    return this.activeProfile(state).config;
  }

  async getProfiles(): Promise<ConfigProfilesSnapshot> {
    return this.snapshot(await this.getState());
  }

  async createProfile(name: string): Promise<ConfigProfileResult> {
    const state = await this.getState();
    const current = this.activeProfile(state);
    const now = new Date().toISOString();
    const profile: ConfigProfile = {
      id: randomUUID(),
      name: cleanName(name, `${current.name} 副本`),
      config: cloneConfig(current.config),
      createdAt: now,
      updatedAt: now,
    };

    state.profiles.push(profile);
    state.activeProfileId = profile.id;
    await this.saveState(state);
    return this.result(state);
  }

  async renameProfile(id: string, name: string): Promise<ConfigProfilesSnapshot> {
    const state = await this.getState();
    const profile = state.profiles.find((item) => item.id === id);
    if (!profile) {
      throw new Error("Config profile not found.");
    }

    profile.name = cleanName(name, profile.name);
    profile.updatedAt = new Date().toISOString();
    await this.saveState(state);
    return this.snapshot(state);
  }

  async switchProfile(id: string): Promise<ConfigProfileResult> {
    const state = await this.getState();
    if (!state.profiles.some((profile) => profile.id === id)) {
      throw new Error("Config profile not found.");
    }

    state.activeProfileId = id;
    await this.saveState(state);
    return this.result(state);
  }

  async deleteProfile(id: string): Promise<ConfigProfileResult> {
    const state = await this.getState();
    if (state.profiles.length <= 1) {
      throw new Error("At least one config profile is required.");
    }

    const nextProfiles = state.profiles.filter((profile) => profile.id !== id);
    if (nextProfiles.length === state.profiles.length) {
      throw new Error("Config profile not found.");
    }

    state.profiles = nextProfiles;
    if (state.activeProfileId === id) {
      state.activeProfileId = state.profiles[0].id;
    }
    await this.saveState(state);
    return this.result(state);
  }

  async update(patch: DeepPartial<AppConfig>): Promise<AppConfig> {
    const state = await this.getState();
    const profile = this.activeProfile(state);
    profile.config = normalizeConfig(deepMerge<AppConfig>(profile.config, patch));
    profile.updatedAt = new Date().toISOString();
    await this.saveState(state);
    return profile.config;
  }

  async save(config: AppConfig): Promise<void> {
    const state = await this.getState();
    const profile = this.activeProfile(state);
    profile.config = normalizeConfig(config);
    profile.updatedAt = new Date().toISOString();
    await this.saveState(state);
  }

  private async getState(): Promise<ConfigState> {
    if (this.state) {
      return this.state;
    }

    try {
      const raw = await fs.readFile(this.getFilePath(), "utf8");
      this.state = stateFromParsed(parseJson(raw));
    } catch {
      this.state = stateFromConfig(await this.readLegacyConfig());
    }

    await this.saveState(this.state);
    return this.state;
  }

  private activeProfile(state: ConfigState): ConfigProfile {
    return (
      state.profiles.find((profile) => profile.id === state.activeProfileId) ??
      state.profiles[0]
    );
  }

  private result(state: ConfigState): ConfigProfileResult {
    return {
      config: this.activeProfile(state).config,
      profiles: this.snapshot(state),
    };
  }

  private snapshot(state: ConfigState): ConfigProfilesSnapshot {
    return {
      activeProfileId: state.activeProfileId,
      profiles: state.profiles.map((profile) => ({
        id: profile.id,
        name: profile.name,
        active: profile.id === state.activeProfileId,
        createdAt: profile.createdAt,
        updatedAt: profile.updatedAt,
      })),
    };
  }

  private async saveState(state: ConfigState): Promise<void> {
    this.state = state;
    const filePath = this.getFilePath();
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(
      filePath,
      `${JSON.stringify(serializableState(state), null, 2)}\n`,
      "utf8",
    );
  }

  private async readLegacyConfig(): Promise<AppConfig> {
    const legacyPath = this.getLegacyFilePath();
    if (legacyPath === this.getFilePath()) {
      return defaultAppConfig;
    }

    try {
      const raw = await fs.readFile(legacyPath, "utf8");
      return normalizeProfileConfig(parseJson(raw));
    } catch {
      return defaultAppConfig;
    }
  }
}
