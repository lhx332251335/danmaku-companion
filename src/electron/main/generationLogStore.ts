import { app } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import { LIMITS, clampOr } from "../../shared/limits";
import type { GenerationLogEntry } from "../../shared/types";

const DEFAULT_LOG_LIMIT = 200;

function normalizeLimit(limit: number | undefined): number {
  return Math.round(clampOr(limit, LIMITS.generationLogLimit, DEFAULT_LOG_LIMIT));
}

export class GenerationLogStore {
  private filePath: string | undefined;
  private entries: GenerationLogEntry[] | undefined;

  private getFilePath(): string {
    this.filePath ??= path.join(app.getPath("userData"), "generation-log.json");
    return this.filePath;
  }

  async get(): Promise<GenerationLogEntry[]> {
    if (!this.entries) {
      this.entries = await this.read();
    }

    return [...this.entries].reverse();
  }

  async append(entry: GenerationLogEntry, limit: number | undefined): Promise<void> {
    if (!this.entries) {
      this.entries = await this.read();
    }

    this.entries.push(entry);
    this.entries = this.entries.slice(-normalizeLimit(limit));
    await this.save();
  }

  async clear(): Promise<void> {
    this.entries = [];
    await this.save();
  }

  private async read(): Promise<GenerationLogEntry[]> {
    try {
      const raw = await fs.readFile(this.getFilePath(), "utf8");
      const parsed = JSON.parse(raw.replace(/^\uFEFF/, "")) as unknown;
      return Array.isArray(parsed) ? (parsed as GenerationLogEntry[]) : [];
    } catch {
      return [];
    }
  }

  private async save(): Promise<void> {
    const filePath = this.getFilePath();
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, `${JSON.stringify(this.entries ?? [], null, 2)}\n`, "utf8");
  }
}
