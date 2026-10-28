/**
 * Pure helpers for the 总览 page (hero copy, the latest-round stage, stat tile series).
 * Kept free of React so they can be unit tested.
 */
import type { GenerationLogEntry, RuntimeSettings, RuntimeState } from "../../shared/types";
import {
  cacheSeries,
  formatSpan,
  latencySeries,
  logReasonLabels,
  paletteColor,
  recentRounds,
} from "./format";

/* ------------------------------------------------------------------ hero */

/** The character's name for headings; an empty name falls back to the app's name. */
export function companionName(name: string | undefined): string {
  const trimmed = (name ?? "").trim();
  return trimmed || "弹幕伴侣";
}

/** The name inside running text, cut to `max` characters (by code point) with an ellipsis. */
export function shortName(name: string | undefined, max = 12): string {
  const chars = [...companionName(name)];
  return chars.length > max ? `${chars.slice(0, max).join("")}…` : chars.join("");
}

export type HeroMood = "watching" | "ready" | "resting" | "trouble";

/** Which hero variant to show: the start delay reads 准备好了, errors 遇到了问题. */
export function heroMood(state: RuntimeState, inStartDelay: boolean): HeroMood {
  if (state === "error") return "trouble";
  if (state !== "running") return "resting";
  return inStartDelay ? "ready" : "watching";
}

export const heroTitleSuffix: Record<HeroMood, string> = {
  watching: "正在陪你看屏幕",
  ready: "准备好了",
  resting: "在休息",
  trouble: "遇到了问题",
};

type RhythmSettings = Pick<
  RuntimeSettings,
  | "intervalMinSeconds"
  | "intervalMaxSeconds"
  | "itemsPerCycle"
  | "releaseWindowMinSeconds"
  | "releaseWindowMaxSeconds"
>;

/** "每轮结束后随机等待 14–28 秒再截图" (or 再生成 when no screenshot is sent). */
function waitClause(runtime: RhythmSettings, visionEnabled: boolean): string {
  const fixed = runtime.intervalMinSeconds === runtime.intervalMaxSeconds;
  const span = formatSpan(runtime.intervalMinSeconds, runtime.intervalMaxSeconds);
  return `每轮结束后${fixed ? "" : "随机"}等待 ${span}再${visionEnabled ? "截图" : "生成"}`;
}

/** "每轮 3 条弹幕，在 6–10 秒内陆续飘出" with the wording adjusted for 1 item or no window. */
function releaseClause(runtime: RhythmSettings): string {
  const count = Math.max(1, Math.round(runtime.itemsPerCycle));
  const low = Math.min(runtime.releaseWindowMinSeconds, runtime.releaseWindowMaxSeconds);
  const high = Math.max(runtime.releaseWindowMinSeconds, runtime.releaseWindowMaxSeconds);
  if (high <= 0) {
    return `每轮 ${count} 条弹幕，${count === 1 ? "立即飘出" : "同时飘出"}`;
  }
  const span = formatSpan(low, high);
  return count === 1 ? `每轮 1 条弹幕，在 ${span}内飘出` : `每轮 ${count} 条弹幕，在 ${span}内陆续飘出`;
}

/**
 * The hero sentence built from the rhythm settings, e.g.
 * 「每轮结束后随机等待 14–28 秒再截图；每轮 3 条弹幕，在 6–10 秒内陆续飘出。」
 * (What Start does first, the start delay, is on the dock.)
 */
export function rhythmSentence(runtime: RhythmSettings, visionEnabled: boolean): string {
  return `${waitClause(runtime, visionEnabled)}；${releaseClause(runtime)}。`;
}

/** The hero sentence during the start delay. */
export function startDelaySentence(seconds: number, name: string | undefined, visionEnabled: boolean): string {
  const delay = Math.max(0, Math.round(seconds));
  if (!visionEnabled) {
    return `启动延迟 ${delay} 秒，之后开始第一轮。`;
  }
  return `启动延迟 ${delay} 秒：先切换到你想让 ${shortName(name)} 看的画面，免得首次截图拍到这个窗口。`;
}

/* ------------------------------------------------------------------ latest round */

/** Header line of the 最近一轮弹幕 card: "14:32:08 · 3/3 条 · 自动" (with MM-DD when not today). */
export function latestRoundLine(
  log: GenerationLogEntry,
  formatClock: (value: string) => string,
  formatMonthDay: (value: string) => string,
  now = Date.now(),
): string {
  const completed = new Date(log.completedAt);
  const today = !Number.isNaN(completed.getTime()) && completed.toDateString() === new Date(now).toDateString();
  const time = today ? formatClock(log.completedAt) : `${formatMonthDay(log.completedAt)} ${formatClock(log.completedAt)}`;
  const generated = log.generatedCount ?? log.comments.length;
  const count = log.requestedCount !== undefined ? `${generated}/${log.requestedCount} 条` : `${generated} 条`;
  return `${time} · ${count} · ${logReasonLabels[log.reason]}`;
}

export interface StageLine {
  text: string;
  color: string;
  /** Top edge as a percentage of the stage height. */
  topPercent: number;
  /** Negative animation delay in seconds, so the lines are already spread out when shown. */
  delay: number;
  /** Resting left position under reduced motion. */
  x: string;
  /** Shares a lane with an earlier line; hidden when the lines do not move. */
  extra: boolean;
}

export interface StageLayout {
  lines: StageLine[];
  /** Font size actually used (the configured size, capped so lines fit the small stage). */
  fontSize: number;
  /** The configured size was larger than the stage can show. */
  scaled: boolean;
  /**
   * Lines per lane. They take turns: each crossing takes the configured time and one
   * animation period is `turns` crossings, so a lane never shows two lines at once.
   */
  turns: number;
  /** Animation period in seconds (`turns` × the crossing time). */
  period: number;
}

/** Tallest font the overview stage shows; larger sizes are scaled down to this. */
export const STAGE_MAX_FONT = 28;
/** Most lines one lane takes turns with (the stylesheet has keyframes up to this). */
export const STAGE_MAX_TURNS = 6;
const STAGE_TOP_PAD = 10;
/** Room kept free at the bottom for the caption chip. */
const STAGE_BOTTOM_PAD = 36;
const LANE_GAP = 8;
const REST_X = ["8%", "30%", "3%", "20%", "38%", "12%"];

/**
 * Places the comments of one round on a stage `height` px tall (its minimum height; the
 * positions are percentages so a taller stage spreads them out). Comments fill lanes top
 * down, like the overlay. With more comments than lanes, the ones sharing a lane follow each
 * other back to back. Colours come from the palette by comment index, like the logs.
 */
export function stageLayout(
  comments: readonly string[],
  palette: readonly string[],
  options: { fontSize: number; height: number; duration: number },
): StageLayout {
  const fontSize = Math.max(10, Math.min(STAGE_MAX_FONT, Math.round(options.fontSize)));
  const lineHeight = fontSize * 1.25;
  const available = Math.max(lineHeight, options.height - STAGE_TOP_PAD - STAGE_BOTTOM_PAD);
  const laneCount = Math.max(1, Math.floor((available + LANE_GAP) / (lineHeight + LANE_GAP)));
  const lanes = Math.max(1, Math.min(laneCount, comments.length));
  const pitch = laneCount > 1 ? (available - lineHeight) / (laneCount - 1) : 0;
  const shown = comments.slice(0, lanes * STAGE_MAX_TURNS);
  const turns = Math.max(1, Math.ceil(shown.length / lanes));
  const crossing = Math.max(1, options.duration);
  const period = crossing * turns;

  const lines = shown.map((text, index): StageLine => {
    const lane = index % lanes;
    const turn = Math.floor(index / lanes);
    // Lanes start at golden-ratio offsets so neighbouring lines never move in step; within a
    // lane, line `turn` enters right after line `turn - 1` has left.
    const phase = (0.47 + lane * 0.618) % 1;
    const offset = (((phase - turn) % turns) + turns) % turns;
    return {
      text,
      color: paletteColor([...palette], index),
      topPercent: ((STAGE_TOP_PAD + lane * pitch) / options.height) * 100,
      delay: -Number((offset * crossing).toFixed(2)),
      x: REST_X[lane % REST_X.length],
      extra: turn > 0,
    };
  });

  return { lines, fontSize, scaled: Math.round(options.fontSize) > STAGE_MAX_FONT, turns, period };
}

/* ------------------------------------------------------------------ stat tiles */

/** One bar of a tile's mini series; the same shape as MiniBars' `MiniBar` (no JSX import here). */
export interface SeriesBar {
  value?: number;
  tone?: "accent" | "bad" | "warn" | "ok" | "muted";
}

const SERIES_COUNT = 10;

function secondsText(ms: number): string {
  return `${(ms / 1000).toFixed(1)} 秒`;
}

/** Latency bars of the last rounds (oldest first): failures red, interrupted rounds amber. */
export function latencyBars(logs: GenerationLogEntry[], count = SERIES_COUNT): SeriesBar[] {
  return latencySeries(logs, count).map(({ log, value }) => ({
    value,
    tone: log.status === "error" ? "bad" : log.status === "aborted" ? "warn" : "accent",
  }));
}

/** Text alternative of the latency bars. */
export function latencyBarsLabel(logs: GenerationLogEntry[], count = SERIES_COUNT): string {
  const series = latencySeries(logs, count);
  if (series.length === 0) {
    return "还没有生成记录";
  }
  const parts = series.map(({ log, value }) => {
    const time = value !== undefined ? secondsText(value) : "无数据";
    return log.status === "error" ? `失败 ${time}` : log.status === "aborted" ? `中断 ${time}` : time;
  });
  return `最近 ${series.length} 轮生成耗时，从旧到新：${parts.join("、")}`;
}

/** Cache share bars of the last rounds (oldest first): dips below half in amber, no data muted. */
export function cacheBars(logs: GenerationLogEntry[], count = SERIES_COUNT): SeriesBar[] {
  return cacheSeries(logs, count).map(({ value }) => ({
    value,
    tone: value === undefined ? "muted" : value < 50 ? "warn" : "ok",
  }));
}

/** Text alternative of the cache bars; names compactions so the dips are explained. */
export function cacheBarsLabel(logs: GenerationLogEntry[], count = SERIES_COUNT): string {
  const series = cacheSeries(logs, count);
  if (series.length === 0) {
    return "还没有缓存数据";
  }
  const parts = series.map(({ log, value }) => {
    const text = value !== undefined ? `${value}%` : "无数据";
    return (log.compaction?.length ?? 0) > 0 ? `${text}（压缩历史）` : text;
  });
  return `最近 ${series.length} 轮缓存命中，从旧到新：${parts.join("、")}`;
}

/** Number of generation rounds the series cover (summaries excluded). */
export function roundCount(logs: GenerationLogEntry[], count = SERIES_COUNT): number {
  return recentRounds(logs, count).length;
}

/** Bars for an empty series, so the tile keeps its shape before the first round. */
export function placeholderBars(count = SERIES_COUNT): SeriesBar[] {
  return Array.from({ length: count }, () => ({}));
}
