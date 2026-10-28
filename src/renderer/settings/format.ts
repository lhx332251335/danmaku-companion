import type { NumericRange } from "../../shared/limits";
import type {
  DanmakuZone,
  GenerationLogCompaction,
  GenerationLogEntry,
  HistoryMode,
  HistoryRecovery,
  RuntimeState,
  RuntimeStatus,
} from "../../shared/types";
import { parseNumberInput, parsePaletteInput } from "../settingsModel";

/* ------------------------------------------------------------------ labels */

export const statusLabels: Record<RuntimeState, string> = {
  idle: "空闲",
  running: "运行中",
  paused: "已暂停",
  error: "错误",
};

export const logStatusLabels: Record<GenerationLogEntry["status"], string> = {
  success: "成功",
  error: "失败",
  aborted: "中断",
};

/** What started a log entry: the timer, the user, or a background context summary. */
export const logReasonLabels: Record<GenerationLogEntry["reason"], string> = {
  timer: "自动",
  manual: "手动",
  summary: "后台",
};

export const historyModeLabels: Record<HistoryMode, string> = {
  "reset-on-limit": "满额重置",
  "batch-sliding": "分批滑动",
  sliding: "逐轮滑动",
};

export const zoneLabels: Record<DanmakuZone, string> = {
  full: "全屏",
  top: "上部",
  middle: "中部",
  bottom: "下部",
};

export const compactionTriggerLabels: Record<GenerationLogCompaction["trigger"], string> = {
  budget: "",
  "413": "413 后",
  reset: "连接被重置后",
};

export const historyRecoveryLabels: Record<HistoryRecovery, string> = {
  images: "失败后丢弃全部历史截图",
  reset: "失败后清空历史",
};

/** Short tag form of historyRecoveryLabels for log rows. */
export const historyRecoveryTags: Record<HistoryRecovery, string> = {
  images: "失败后丢弃历史截图",
  reset: "失败后清空历史",
};

export type Tone = "neutral" | "accent" | "coral" | "ok" | "warn" | "bad" | "violet";

/** Status pill of a log row: summaries are violet 摘要 unless they failed. */
export function logPill(log: GenerationLogEntry): { label: string; tone: Tone } {
  if (log.reason === "summary" && log.status === "success") {
    return { label: "摘要", tone: "violet" };
  }
  const tone: Tone = log.status === "success" ? "ok" : log.status === "error" ? "bad" : "warn";
  return { label: logStatusLabels[log.status], tone };
}

/* ------------------------------------------------------------------ numbers */

const integerFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

/** 5612 → "5,612". */
export function formatCount(value: number | undefined): string {
  return value === undefined || !Number.isFinite(value) ? "—" : integerFormat.format(value);
}

/** Trims float noise: 0.92 * 100 → 92, not 92.00000000000001. */
export function roundForDisplay(value: number, digits = 6): number {
  return Number(value.toFixed(digits));
}

/**
 * Parses typed text in displayed units (stored × scale) and returns the stored value,
 * clamped to `range` (stored units) and rounded when `integer`. Undefined = nothing usable.
 */
export function parseScaledInput(
  raw: string,
  range: NumericRange,
  integer = false,
  scale = 1,
): number | undefined {
  if (scale === 1) {
    return parseNumberInput(raw, range, integer);
  }
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  const shown = Number(trimmed);
  if (!Number.isFinite(shown)) return undefined;
  return parseNumberInput(String(roundForDisplay(shown / scale, 9)), range, integer);
}

/** Text shown for a stored value. */
export function displayNumber(value: number, scale = 1): string {
  return Number.isFinite(value) ? String(roundForDisplay(value * scale)) : "";
}

/** "5 – 1800 秒", "20% – 100%" (scale 100, unit "%"), "0.5 – 0.95". */
export function rangeHint(range: NumericRange, unit = "", scale = 1): string {
  const low = roundForDisplay(range.min * scale);
  const high = roundForDisplay(range.max * scale);
  if (unit === "%") {
    return `${low}% – ${high}%`;
  }
  return `${low} – ${high}${unit ? ` ${unit}` : ""}`;
}

/** "14–28 秒", or "18 秒" when both ends are equal. */
export function formatSpan(min: number, max: number, unit = "秒"): string {
  const low = Math.min(min, max);
  const high = Math.max(min, max);
  return low === high ? `${low} ${unit}` : `${low}–${high} ${unit}`;
}

/** "412 ms", "2.4 s"; "—" when unknown. */
export function formatDuration(ms: number | undefined): string {
  if (ms === undefined || !Number.isFinite(ms)) return "—";
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms)} ms`;
}

/** Latency in seconds without the unit: 2410 → "2.41". */
export function formatSecondsValue(ms: number | undefined, digits = 2): string {
  return ms === undefined || !Number.isFinite(ms) ? "—" : (ms / 1000).toFixed(digits);
}

export function formatBytes(bytes: number | undefined): string {
  if (!bytes || bytes <= 0) {
    return "—";
  }

  if (bytes >= 1024 * 1024) {
    return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  }

  return `${Math.round(bytes / 1024)} KB`;
}

/** Bytes as MiB without the unit, for "3.1 / 48 MB" readouts. */
export function formatMegabytes(bytes: number | undefined, digits = 1): string {
  if (!bytes || bytes <= 0) {
    return "—";
  }
  const value = bytes / 1024 / 1024;
  const factor = 10 ** (value >= 100 ? 0 : digits);
  return String(roundForDisplay(Math.round(value * factor) / factor));
}

export function formatCacheUsage(cached: number | undefined, prompt: number | undefined): string {
  if (cached === undefined) {
    return prompt === undefined ? "—" : `? / ${prompt}`;
  }

  if (!prompt) {
    return String(cached);
  }

  return `${cached} / ${prompt} (${Math.round((cached / prompt) * 100)}%)`;
}

/** Cached share of the prompt in percent (0–100), or undefined when it cannot be told. */
export function cachePercent(
  cached: number | undefined,
  prompt: number | undefined,
): number | undefined {
  if (cached === undefined || !prompt || prompt <= 0) {
    return undefined;
  }
  return Math.max(0, Math.min(100, Math.round((cached / prompt) * 100)));
}

/* ------------------------------------------------------------------ dates */

const clockFormat = new Intl.DateTimeFormat("zh-CN", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

function validDate(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

/** "14:32:08" (24 h), or "—" for a missing or invalid time. */
export function formatClock(value: string | undefined): string {
  const date = validDate(value);
  return date ? clockFormat.format(date) : "—";
}

/** "10-21" (MM-DD in local time), or "—" for a missing or invalid time. */
export function formatMonthDay(value: string | undefined): string {
  const date = validDate(value);
  if (!date) return "—";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/* ------------------------------------------------------------------ countdown */

export type CountdownPhase = "countdown" | "delay" | "generating" | "stopped";

export interface CountdownState {
  /**
   * countdown: waiting for the next timed capture; delay: the start delay before the first
   * capture; generating: running with nothing scheduled (a cycle is in flight); stopped: not
   * running and nothing scheduled.
   */
  phase: CountdownPhase;
  /** Milliseconds until the capture (0 when due), undefined unless a capture is scheduled. */
  remainingMs?: number;
  /** Whole seconds left, rounded up, so "1 秒" shows until the capture. */
  remainingSeconds?: number;
  /** Length of the whole wait, when its start is known. */
  totalMs?: number;
  /** Share of the wait that has passed (0–1), when its start is known. */
  elapsedFraction?: number;
}

/**
 * Where the next capture stands at `nowMs`. The wait runs from nextCycleArmedAt (or
 * `fallbackArmedAtMs` from an older main process that did not send it) to nextCycleAt.
 */
export function countdownState(
  status: Pick<RuntimeStatus, "state" | "nextCycleAt" | "nextCycleArmedAt" | "nextCycleIsFirst">,
  nowMs: number,
  fallbackArmedAtMs?: number,
): CountdownState {
  const due = status.nextCycleAt ? Date.parse(status.nextCycleAt) : Number.NaN;
  if (!Number.isFinite(due)) {
    return { phase: status.state === "running" ? "generating" : "stopped" };
  }

  const remainingMs = Math.max(0, due - nowMs);
  const parsedArmed = status.nextCycleArmedAt ? Date.parse(status.nextCycleArmedAt) : Number.NaN;
  const armed = Number.isFinite(parsedArmed) ? parsedArmed : fallbackArmedAtMs;
  const state: CountdownState = {
    phase: status.nextCycleIsFirst ? "delay" : "countdown",
    remainingMs,
    remainingSeconds: Math.ceil(remainingMs / 1000),
  };
  if (armed !== undefined && Number.isFinite(armed) && due > armed) {
    const totalMs = due - armed;
    state.totalMs = totalMs;
    state.elapsedFraction = Math.max(0, Math.min(1, (nowMs - armed) / totalMs));
  } else if (armed !== undefined && Number.isFinite(armed)) {
    state.totalMs = 0;
    state.elapsedFraction = 1;
  }
  return state;
}

/** "12" + "秒" below a minute, "3:05" (no unit) from a minute on. */
export function formatCountdown(seconds: number): { value: string; unit: string; spoken: string } {
  const whole = Math.max(0, Math.ceil(seconds));
  if (whole < 60) {
    return { value: String(whole), unit: "秒", spoken: `${whole} 秒` };
  }
  const minutes = Math.floor(whole / 60);
  const rest = whole % 60;
  return {
    value: `${minutes}:${String(rest).padStart(2, "0")}`,
    unit: "",
    spoken: rest === 0 ? `${minutes} 分钟` : `${minutes} 分 ${rest} 秒`,
  };
}

/* ------------------------------------------------------------------ logs */

export function screenLabel(log: GenerationLogEntry): string {
  if (!log.screen.enabled) {
    return "无截图";
  }

  if (!log.screen.captured) {
    return "截图失败";
  }

  return `${log.screen.width ?? "—"}×${log.screen.height ?? "—"}`;
}

export function compactionLabel(log: GenerationLogEntry): string {
  const parts = (log.compaction ?? []).map((entry) => {
    const trigger =
      compactionTriggerLabels[entry.trigger] || (entry.reason === "bytes" ? "超出大小" : "超出张数");
    return `${trigger}丢弃 ${entry.droppedImages} 张`;
  });
  if (log.historyRecovery) {
    parts.push(historyRecoveryLabels[log.historyRecovery]);
  }

  return parts.length > 0 ? parts.join("；") : "—";
}

/** Total screenshots dropped by the compactions of one log entry. */
export function droppedImages(log: GenerationLogEntry): number {
  return (log.compaction ?? []).reduce((sum, entry) => sum + entry.droppedImages, 0);
}

export interface LogFlag {
  key: "cache" | "truncated" | "compaction" | "resized" | "recovery" | "summary";
  label: string;
  tone: Tone;
  /** Longer explanation for a title or a details line. */
  description: string;
}

/**
 * Short tags for a log row: cache share, truncated output, compaction (−n 张, 413 后),
 * a screenshot that was shrunk to fit, the history recovery after a failure, summary length.
 */
export function logFlags(log: GenerationLogEntry): LogFlag[] {
  const flags: LogFlag[] = [];
  const percent = cachePercent(log.cachedInputTokens, log.promptTokens);
  if (percent !== undefined) {
    flags.push({
      key: "cache",
      label: `缓存 ${percent}%`,
      tone: "neutral",
      description: `缓存 / 输入 tokens：${formatCacheUsage(log.cachedInputTokens, log.promptTokens)}`,
    });
  }
  if (log.finishReason === "length") {
    flags.push({
      key: "truncated",
      label: "输出截断",
      tone: "warn",
      description: "达到最大输出被截断，可调大最大输出",
    });
  }
  if (log.compaction && log.compaction.length > 0) {
    const after = log.compaction.find((entry) => entry.trigger !== "budget");
    const prefix = after ? `${compactionTriggerLabels[after.trigger]}压缩` : "压缩";
    flags.push({
      key: "compaction",
      label: `${prefix} −${droppedImages(log)} 张`,
      tone: "neutral",
      description: compactionLabel(log),
    });
  }
  if (log.screen.resizedToFit) {
    flags.push({
      key: "resized",
      label: "已缩小",
      tone: "neutral",
      description: "截图已缩小以适应请求体上限",
    });
  }
  if (log.historyRecovery) {
    flags.push({
      key: "recovery",
      label: historyRecoveryTags[log.historyRecovery],
      tone: "warn",
      description: historyRecoveryLabels[log.historyRecovery],
    });
  }
  if (log.reason === "summary" && log.summary) {
    flags.push({
      key: "summary",
      label: `${log.summary.length} 字`,
      tone: "violet",
      description: `上下文摘要 ${log.summary.length} 字`,
    });
  }
  return flags;
}

export function isSummaryLog(log: GenerationLogEntry): boolean {
  return log.reason === "summary";
}

export function isFailedLog(log: GenerationLogEntry): boolean {
  return log.status === "error";
}

/** Logs are stored newest first. The newest successful round that produced comments. */
export function latestCommentLog(logs: GenerationLogEntry[]): GenerationLogEntry | undefined {
  return logs.find(
    (log) => log.reason !== "summary" && log.status === "success" && log.comments.length > 0,
  );
}

/** The newest log entry that compacted history or recovered it after a failure. */
export function latestCompactionLog(logs: GenerationLogEntry[]): GenerationLogEntry | undefined {
  return logs.find((log) => (log.compaction?.length ?? 0) > 0 || Boolean(log.historyRecovery));
}

export interface SeriesPoint {
  log: GenerationLogEntry;
  /** Plotted value; undefined when the entry has none (e.g. no token usage reported). */
  value?: number;
}

/** The last `count` generation rounds (summaries excluded), oldest first, for sparklines. */
export function recentRounds(logs: GenerationLogEntry[], count = 10): GenerationLogEntry[] {
  return logs
    .filter((log) => log.reason !== "summary")
    .slice(0, count)
    .reverse();
}

/** Duration of the last rounds, oldest first. Failed rounds keep their duration. */
export function latencySeries(logs: GenerationLogEntry[], count = 10): SeriesPoint[] {
  return recentRounds(logs, count).map((log) => ({ log, value: log.durationMs }));
}

/** Cache share (0–100) of the last rounds, oldest first; dips show compactions. */
export function cacheSeries(logs: GenerationLogEntry[], count = 10): SeriesPoint[] {
  return recentRounds(logs, count).map((log) => ({
    log,
    value: cachePercent(log.cachedInputTokens, log.promptTokens),
  }));
}

/** Median duration (ms) of the last `count` successful generation rounds; undefined when none. */
export function medianLatency(logs: GenerationLogEntry[], count = 10): number | undefined {
  const durations = logs
    .filter((log) => log.reason !== "summary" && log.status === "success" && log.durationMs > 0)
    .slice(0, count)
    .map((log) => log.durationMs)
    .sort((a, b) => a - b);
  if (durations.length === 0) return undefined;
  const middle = Math.floor(durations.length / 2);
  return durations.length % 2 === 1
    ? durations[middle]
    : (durations[middle - 1] + durations[middle]) / 2;
}

/* ------------------------------------------------------------------ palette */

export function isCssColor(value: string): boolean {
  return typeof CSS === "undefined" || typeof CSS.supports !== "function"
    ? true
    : CSS.supports("color", value);
}

/** Keeps the valid CSS colours of a comma list; undefined when none are left. */
export function parsePalette(raw: string): string[] | undefined {
  return parsePaletteInput(raw, isCssColor);
}

/** Palette colour for the n-th comment (logs do not store colours). */
export function paletteColor(palette: string[], index: number): string {
  return palette.length > 0 ? palette[index % palette.length] : "#f8fafc";
}

/* ------------------------------------------------------------------ text */

/** "312 字 · 9 行" */
export function countText(value: string): string {
  const chars = [...value].length;
  const lines = value === "" ? 0 : value.split("\n").length;
  return `${chars} 字 · ${lines} 行`;
}

/** Trims and cuts to `max` characters (code points), ending in "…" when cut. */
export function shorten(text: string, max = 8): string {
  const chars = Array.from(text.trim());
  return chars.length > max ? `${chars.slice(0, max - 1).join("")}…` : chars.join("");
}
