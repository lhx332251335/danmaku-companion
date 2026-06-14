import { app } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import { defaultAppConfig } from "../../shared/defaultConfig";
import type { AppConfig, DeepPartial } from "../../shared/types";

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

function parseConfig(raw: string): DeepPartial<AppConfig> {
  return JSON.parse(raw.replace(/^\uFEFF/, "")) as DeepPartial<AppConfig>;
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

export class ConfigStore {
  private filePath: string | undefined;
  private config: AppConfig | undefined;

  private getFilePath(): string {
    this.filePath ??= path.join(app.getPath("userData"), "config.json");
    return this.filePath;
  }

  private getLegacyFilePath(): string {
    return path.join(app.getPath("appData"), "Electron", "config.json");
  }

  async get(): Promise<AppConfig> {
    if (this.config) {
      return this.config;
    }

    try {
      const raw = await fs.readFile(this.getFilePath(), "utf8");
      const parsed = migrateParsedConfig(parseConfig(raw));
      const merged = deepMerge<AppConfig>(defaultAppConfig, parsed);
      this.config = normalizeConfig(merged);
      if (this.config !== merged) {
        await this.save(this.config);
      }
    } catch {
      this.config = normalizeConfig(await this.readLegacyConfig());
      await this.save(this.config);
    }

    return this.config;
  }

  async update(patch: DeepPartial<AppConfig>): Promise<AppConfig> {
    const current = await this.get();
    const updated = normalizeConfig(deepMerge<AppConfig>(current, patch));
    this.config = updated;
    await this.save(updated);
    return updated;
  }

  async save(config: AppConfig): Promise<void> {
    const filePath = this.getFilePath();
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  }

  private async readLegacyConfig(): Promise<AppConfig> {
    const legacyPath = this.getLegacyFilePath();
    if (legacyPath === this.getFilePath()) {
      return defaultAppConfig;
    }

    try {
      const raw = await fs.readFile(legacyPath, "utf8");
      const parsed = migrateParsedConfig(parseConfig(raw));
      return deepMerge<AppConfig>(defaultAppConfig, parsed);
    } catch {
      return defaultAppConfig;
    }
  }
}
