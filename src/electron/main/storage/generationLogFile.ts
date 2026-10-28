import type { GenerationLogEntry } from "../../../shared/types";

export interface ParsedGenerationLog {
  entries: GenerationLogEntry[];
  /** Non-empty lines in the file, valid or not. */
  lineCount: number;
  /** Something was skipped (bad line, cut-off tail, old format), so the file should be rewritten. */
  needsRewrite: boolean;
}

/** The file may grow to this multiple of the entry limit before it is compacted. */
const COMPACTION_FACTOR = 1.5;

function isLogEntry(value: unknown): value is GenerationLogEntry {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const entry = value as Record<string, unknown>;
  return (
    typeof entry.id === "string" &&
    Boolean(entry.screen) &&
    typeof entry.screen === "object" &&
    Array.isArray(entry.comments)
  );
}

function parseLegacyArray(text: string): ParsedGenerationLog {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = [];
  }

  const entries = Array.isArray(parsed) ? parsed.filter(isLogEntry) : [];
  return { entries, lineCount: 0, needsRewrite: true };
}

/** Parses the JSON Lines log, skipping damaged lines. Also accepts the old pretty-printed JSON array. */
export function parseGenerationLog(raw: string): ParsedGenerationLog {
  const text = raw.replace(/^\uFEFF/, "");
  if (text.trimStart().startsWith("[")) {
    return parseLegacyArray(text);
  }

  const entries: GenerationLogEntry[] = [];
  let lineCount = 0;
  let needsRewrite = text.length > 0 && !text.endsWith("\n");
  for (const line of text.split("\n")) {
    if (!line.trim()) {
      continue;
    }

    lineCount += 1;
    try {
      const value: unknown = JSON.parse(line);
      if (isLogEntry(value)) {
        entries.push(value);
        continue;
      }
    } catch {
      // A cut-off line from an interrupted append.
    }
    needsRewrite = true;
  }

  return { entries, lineCount, needsRewrite };
}

export function toJsonLine(entry: GenerationLogEntry): string {
  return `${JSON.stringify(entry)}\n`;
}

export function toJsonLines(entries: readonly GenerationLogEntry[]): string {
  return entries.map(toJsonLine).join("");
}

export function shouldCompact(lineCount: number, limit: number): boolean {
  return lineCount > Math.ceil(limit * COMPACTION_FACTOR);
}
