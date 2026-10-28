import { describe, expect, it } from "vitest";
import { defaultAppConfig } from "../src/shared/defaultConfig";
import type { GenerationLogEntry } from "../src/shared/types";
import {
  STAGE_MAX_FONT,
  STAGE_MAX_TURNS,
  cacheBars,
  cacheBarsLabel,
  companionName,
  heroMood,
  heroTitleSuffix,
  latencyBars,
  latencyBarsLabel,
  latestRoundLine,
  placeholderBars,
  rhythmSentence,
  roundCount,
  shortName,
  stageLayout,
  startDelaySentence,
} from "../src/renderer/settings/overviewModel";

function log(overrides: Partial<GenerationLogEntry> = {}): GenerationLogEntry {
  return {
    id: overrides.id ?? `log-${Math.random()}`,
    cycle: 1,
    reason: "timer",
    status: "success",
    startedAt: "2026-10-28T10:00:00.000Z",
    completedAt: "2026-10-28T10:00:02.000Z",
    durationMs: 2000,
    requestedCount: 3,
    generatedCount: 3,
    screen: { enabled: true, captured: true, width: 960, height: 540 },
    comments: ["a", "b", "c"],
    ...overrides,
  };
}

const runtime = defaultAppConfig.runtime;

describe("hero copy", () => {
  it("falls back to the app name and shortens long names in running text", () => {
    expect(companionName("  ")).toBe("弹幕伴侣");
    expect(companionName(" Mika ")).toBe("Mika");
    expect(shortName("Mika")).toBe("Mika");
    expect(shortName("一二三四五六七八九十十一十二十三", 12)).toBe("一二三四五六七八九十十一…");
    // Counts code points, so an emoji is not cut in half.
    expect(shortName("😀".repeat(14), 12)).toBe(`${"😀".repeat(12)}…`);
  });

  it("picks the title variant from the state and the start delay", () => {
    expect(heroTitleSuffix[heroMood("running", false)]).toBe("正在陪你看屏幕");
    expect(heroTitleSuffix[heroMood("running", true)]).toBe("准备好了");
    expect(heroTitleSuffix[heroMood("paused", false)]).toBe("在休息");
    expect(heroTitleSuffix[heroMood("idle", false)]).toBe("在休息");
    expect(heroTitleSuffix[heroMood("error", true)]).toBe("遇到了问题");
  });

  it("builds the rhythm sentence from interval, items and release window", () => {
    expect(rhythmSentence(runtime, true)).toBe(
      "每轮结束后随机等待 14–28 秒再截图；每轮 3 条弹幕，在 6–10 秒内陆续飘出。",
    );
    expect(
      rhythmSentence(
        { ...runtime, intervalMinSeconds: 20, intervalMaxSeconds: 20, itemsPerCycle: 1, releaseWindowMinSeconds: 0, releaseWindowMaxSeconds: 0 },
        false,
      ),
    ).toBe("每轮结束后等待 20 秒再生成；每轮 1 条弹幕，立即飘出。");
    expect(rhythmSentence({ ...runtime, releaseWindowMinSeconds: 0, releaseWindowMaxSeconds: 0 }, true)).toContain(
      "每轮 3 条弹幕，同时飘出",
    );
    expect(rhythmSentence({ ...runtime, itemsPerCycle: 1 }, true)).toContain("每轮 1 条弹幕，在 6–10 秒内飘出");
  });

  it("explains the start delay", () => {
    expect(startDelaySentence(5, "Mika", true)).toBe(
      "启动延迟 5 秒：先切换到你想让 Mika 看的画面，免得首次截图拍到这个窗口。",
    );
    expect(startDelaySentence(5, "Mika", false)).toBe("启动延迟 5 秒，之后开始第一轮。");
  });
});

describe("latest round", () => {
  it("formats time, counts and reason, adding the date when not today", () => {
    const entry = log({ reason: "manual", generatedCount: 2, completedAt: "2026-10-28T10:00:02.000Z" });
    const clock = () => "10:00:02";
    const day = () => "10-28";
    expect(latestRoundLine(entry, clock, day, Date.parse("2026-10-28T12:00:00.000Z"))).toBe("10:00:02 · 2/3 条 · 手动");
    expect(latestRoundLine(entry, clock, day, Date.parse("2026-10-30T12:00:00.000Z"))).toBe(
      "10-28 10:00:02 · 2/3 条 · 手动",
    );
  });

  it("puts one comment per lane with the configured size and palette colours", () => {
    const layout = stageLayout(["a", "b", "c"], ["#111111", "#222222"], { fontSize: 22, height: 160, duration: 10 });
    expect(layout.fontSize).toBe(22);
    expect(layout.scaled).toBe(false);
    expect(layout.turns).toBe(1);
    expect(layout.period).toBe(10);
    expect(layout.lines.map((line) => line.color)).toEqual(["#111111", "#222222", "#111111"]);
    expect(layout.lines.every((line) => !line.extra)).toBe(true);
    const tops = layout.lines.map((line) => line.topPercent);
    expect(tops[0]).toBeLessThan(tops[1]);
    expect(tops[1]).toBeLessThan(tops[2]);
    // The last lane ends above the caption chip at the bottom.
    expect(((tops[2] / 100) * 160 + 22 * 1.25)).toBeLessThanOrEqual(160 - 32);
    expect(layout.lines.every((line) => line.delay <= 0 && line.delay > -10)).toBe(true);
  });

  it("scales big fonts down and lets comments that share a lane take turns", () => {
    const comments = Array.from({ length: 12 }, (_, index) => `第 ${index + 1} 条`);
    const layout = stageLayout(comments, [], { fontSize: 40, height: 160, duration: 10 });
    expect(layout.fontSize).toBe(STAGE_MAX_FONT);
    expect(layout.scaled).toBe(true);
    const lanes = new Set(layout.lines.map((line) => line.topPercent)).size;
    expect(layout.turns).toBe(Math.ceil(12 / lanes));
    expect(layout.turns).toBeLessThanOrEqual(STAGE_MAX_TURNS);
    expect(layout.period).toBe(10 * layout.turns);
    // Lines in one lane are a whole crossing apart, so they never overlap.
    const firstLane = layout.lines.filter((line) => line.topPercent === layout.lines[0].topPercent);
    const offsets = firstLane.map((line) => -line.delay).sort((a, b) => a - b);
    for (let index = 1; index < offsets.length; index += 1) {
      expect(offsets[index] - offsets[index - 1]).toBeCloseTo(10, 1);
    }
    expect(layout.lines.filter((line) => !line.extra)).toHaveLength(lanes);
    expect(layout.lines[0].color).toBe("#f8fafc");
  });
});

describe("stat tile series", () => {
  const logs = [
    log({ id: "summary", reason: "summary", durationMs: 7000, comments: [], summary: "x" }),
    log({ id: "new", durationMs: 2500, cachedInputTokens: 80, promptTokens: 100 }),
    log({ id: "failed", status: "error", durationMs: 3000 }),
    log({ id: "aborted", status: "aborted", durationMs: 800 }),
    log({
      id: "compacted",
      durationMs: 2200,
      cachedInputTokens: 10,
      promptTokens: 100,
      compaction: [{ trigger: "budget", reason: "images", droppedImages: 12 }],
    }),
  ];

  it("colours failed and interrupted rounds and skips summaries", () => {
    expect(roundCount(logs)).toBe(4);
    expect(latencyBars(logs)).toEqual([
      { value: 2200, tone: "accent" },
      { value: 800, tone: "warn" },
      { value: 3000, tone: "bad" },
      { value: 2500, tone: "accent" },
    ]);
    expect(latencyBarsLabel(logs)).toBe("最近 4 轮生成耗时，从旧到新：2.2 秒、中断 0.8 秒、失败 3.0 秒、2.5 秒");
    expect(latencyBarsLabel([])).toBe("还没有生成记录");
  });

  it("shows cache dips and missing usage, and names compactions in the label", () => {
    expect(cacheBars(logs)).toEqual([
      { value: 10, tone: "warn" },
      { value: undefined, tone: "muted" },
      { value: undefined, tone: "muted" },
      { value: 80, tone: "ok" },
    ]);
    expect(cacheBarsLabel(logs)).toBe("最近 4 轮缓存命中，从旧到新：10%（压缩历史）、无数据、无数据、80%");
    expect(cacheBarsLabel([])).toBe("还没有缓存数据");
    expect(placeholderBars(3)).toEqual([{}, {}, {}]);
  });
});
