import { app } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import { LIMITS, clampOr } from "../../shared/limits";
import type { GenerationLogEntry } from "../../shared/types";
import { WriteQueue, readTextIfExists, writeFileAtomic } from "./storage/atomicFile";
import {
  parseGenerationLog,
  shouldCompact,
  toJsonLine,
  toJsonLines,
} from "./storage/generationLogFile";

const DEFAULT_LOG_LIMIT = 200;
const LOG_FILE_NAME = "generation-log.jsonl";
const LEGACY_LOG_FILE_NAME = "generation-log.json";

function normalizeLimit(limit: number | undefined): number {
  return Math.round(clampOr(limit, LIMITS.generationLogLimit, DEFAULT_LOG_LIMIT));
}

/**
 * Keeps the log as JSON Lines: each entry is one appended line, and the file is rewritten
 * atomically only when it has grown well past the limit or was damaged.
 */
export class GenerationLogStore {
  private dir: string | undefined;
  private entries: GenerationLogEntry[] | undefined;
  private loading: Promise<GenerationLogEntry[]> | undefined;
  private readonly writes = new WriteQueue();
  private fileLineCount = 0;
  private rewriteNeeded = false;

  private getDir(): string {
    this.dir ??= app.getPath("userData");
    return this.dir;
  }

  private getFilePath(): string {
    return path.join(this.getDir(), LOG_FILE_NAME);
  }

  private getLegacyFilePath(): string {
    return path.join(this.getDir(), LEGACY_LOG_FILE_NAME);
  }

  /** Newest first. Without a limit, returns everything currently held. */
  async get(limit?: number): Promise<GenerationLogEntry[]> {
    const entries = await this.load();
    const visible = limit === undefined ? entries : entries.slice(-normalizeLimit(limit));
    return [...visible].reverse();
  }

  async append(entry: GenerationLogEntry, limit: number | undefined): Promise<void> {
    const entries = await this.load();
    const maxEntries = normalizeLimit(limit);
    entries.push(entry);
    if (entries.length > maxEntries) {
      entries.splice(0, entries.length - maxEntries);
    }

    this.fileLineCount += 1;
    if (this.rewriteNeeded || shouldCompact(this.fileLineCount, maxEntries)) {
      await this.queueRewrite(entries);
    } else {
      await this.queueAppend(entry);
    }
  }

  async clear(): Promise<void> {
    const entries = await this.load();
    entries.length = 0;
    await this.queueRewrite(entries);
  }

  hasPendingWrites(): boolean {
    return this.writes.hasPending();
  }

  /** Resolves once every queued write has settled. */
  flush(): Promise<void> {
    return this.writes.flush();
  }

  private load(): Promise<GenerationLogEntry[]> {
    if (this.entries) {
      return Promise.resolve(this.entries);
    }

    this.loading ??= this.read()
      .then((entries) => {
        this.entries = entries;
        return entries;
      })
      .finally(() => {
        this.loading = undefined;
      });
    return this.loading;
  }

  private async read(): Promise<GenerationLogEntry[]> {
    const raw =
      (await readTextIfExists(this.getFilePath())) ??
      (await readTextIfExists(this.getLegacyFilePath()));
    const parsed = parseGenerationLog(raw ?? "");
    this.fileLineCount = parsed.lineCount;
    // A missing file is rewritten too, so the first write also creates the directory.
    this.rewriteNeeded = raw === undefined || parsed.needsRewrite;
    return parsed.entries;
  }

  /** The text is captured now, so appends queued behind this write are not duplicated. */
  private queueRewrite(entries: readonly GenerationLogEntry[]): Promise<void> {
    const text = toJsonLines(entries);
    this.fileLineCount = entries.length;
    this.rewriteNeeded = false;
    return this.writes.run(async () => {
      try {
        await writeFileAtomic(this.getFilePath(), text);
      } catch (error) {
        this.rewriteNeeded = true;
        throw error;
      }
      await fs.rm(this.getLegacyFilePath(), { force: true }).catch(() => undefined);
    });
  }

  private queueAppend(entry: GenerationLogEntry): Promise<void> {
    const line = toJsonLine(entry);
    return this.writes.run(async () => {
      try {
        await fs.appendFile(this.getFilePath(), line, "utf8");
      } catch (error) {
        this.rewriteNeeded = true;
        throw error;
      }
    });
  }
}
