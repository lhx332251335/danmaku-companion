import { clampToRange, type NumericRange } from "../shared/limits";
import type { AppConfig, DeepPartial, RuntimeStatus } from "../shared/types";

type ConfigRecord = Record<string, unknown>;

function isRecord(value: unknown): value is ConfigRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function sameValue(left: unknown, right: unknown): boolean {
  return left === right || JSON.stringify(left) === JSON.stringify(right);
}

/** The patch the settings form sends: everything except fields main owns (the run flag). */
export function toConfigPatch(draft: AppConfig): DeepPartial<AppConfig> {
  const { enabled: _ownedByMain, ...runtime } = draft.runtime;
  return { ...draft, runtime };
}

export function isDraftDirty(config: AppConfig, draft: AppConfig): boolean {
  const saved = toConfigPatch(config) as ConfigRecord;
  const edited = toConfigPatch(draft) as ConfigRecord;
  const keys = new Set([...Object.keys(saved), ...Object.keys(edited)]);

  return [...keys].some((key) => {
    const left = saved[key];
    const right = edited[key];
    if (!isRecord(left) || !isRecord(right)) {
      return !sameValue(left, right);
    }

    const fields = new Set([...Object.keys(left), ...Object.keys(right)]);
    return [...fields].some((field) => !sameValue(left[field], right[field]));
  });
}

/**
 * Moves the draft onto a newer saved config: fields the user has not edited since
 * `previousBase` take the new value, edited fields keep the user's value.
 */
export function rebaseDraft(
  previousBase: AppConfig,
  nextBase: AppConfig,
  draft: AppConfig,
): AppConfig {
  const previous = previousBase as unknown as ConfigRecord;
  const mine = draft as unknown as ConfigRecord;
  const output: ConfigRecord = {};

  for (const [key, base] of Object.entries(nextBase as unknown as ConfigRecord)) {
    const before = previous[key];
    const edited = mine[key];
    if (!isRecord(base) || !isRecord(before) || !isRecord(edited)) {
      output[key] = edited === undefined || sameValue(edited, before) ? base : edited;
      continue;
    }

    const section: ConfigRecord = {};
    for (const [field, value] of Object.entries(base)) {
      section[field] =
        !(field in edited) || sameValue(edited[field], before[field]) ? value : edited[field];
    }
    output[key] = section;
  }

  const rebased = output as unknown as AppConfig;
  return {
    ...rebased,
    runtime: { ...rebased.runtime, enabled: nextBase.runtime.enabled },
  };
}

/** Parses a number field; undefined means "nothing usable typed yet" and must not be stored. */
export function parseNumberInput(
  raw: string,
  range: NumericRange,
  integer = false,
): number | undefined {
  const trimmed = raw.trim();
  if (!trimmed) {
    return undefined;
  }

  const value = Number(trimmed);
  if (!Number.isFinite(value)) {
    return undefined;
  }

  return clampToRange(integer ? Math.round(value) : value, range);
}

export function parseListInput(raw: string, maxItems = Number.POSITIVE_INFINITY): string[] {
  const items = raw
    .split(/[,，]/)
    .map((item) => item.trim())
    .filter(Boolean);
  return [...new Set(items)].slice(0, maxItems);
}

export const PALETTE_MAX_COLORS = 8;

/** Keeps the valid colours; undefined when none are left, so the palette is never emptied. */
export function parsePaletteInput(
  raw: string,
  isColor: (value: string) => boolean,
): string[] | undefined {
  const colors = parseListInput(raw)
    .filter((color) => isColor(color))
    .slice(0, PALETTE_MAX_COLORS);
  return colors.length > 0 ? colors : undefined;
}

const REMOTE_ERROR_PREFIX = /^Error invoking remote method '[^']*':\s*/;

export function describeError(error: unknown): string {
  const message =
    error instanceof Error ? error.message : typeof error === "string" ? error : "";
  const cleaned = message
    .replace(REMOTE_ERROR_PREFIX, "")
    .replace(/^(?:[A-Za-z]*Error:\s*)+/, "")
    .trim();
  return cleaned || "未知错误";
}

/**
 * Main appends a log entry at the end of every generation and then broadcasts the status.
 * Other broadcasts (cleared history, repeated identical states) add no entry.
 */
export function shouldReloadLogs(previous: RuntimeStatus, next: RuntimeStatus): boolean {
  return (
    next.cycles !== previous.cycles ||
    next.state !== previous.state ||
    next.lastGeneratedAt !== previous.lastGeneratedAt ||
    next.lastError !== undefined
  );
}
