import { describe, expect, it } from "vitest";
import { LIMITS } from "../src/shared/limits";
import type { GenerationLogEntry } from "../src/shared/types";
import {
  cachePercent,
  cacheSeries,
  compactionLabel,
  countText,
  countdownState,
  displayNumber,
  formatBytes,
  formatCacheUsage,
  formatCountdown,
  formatMegabytes,
  formatSpan,
  latencySeries,
  latestCommentLog,
  latestCompactionLog,
  logFlags,
  logPill,
  parseScaledInput,
  rangeHint,
  roundForDisplay,
} from "../src/renderer/settings/format";
import { dirtyPages } from "../src/renderer/settings/dirty";
import { pageFromHash } from "../src/renderer/settings/constants";
import { makeConfig } from "./helpers";

function log(overrides: Partial<GenerationLogEntry> = {}): GenerationLogEntry {
  return {
    id: overrides.id ?? `log-${Math.random()}`,
    cycle: 1,
    reason: "timer",
    status: "success",
    startedAt: "2026-10-28T10:00:00.000Z",
    completedAt: "2026-10-28T10:00:02.000Z",
    durationMs: 2000,
    screen: { enabled: true, captured: true, width: 960, height: 540 },
    comments: ["a", "b"],
    ...overrides,
  };
}

describe("countdownState", () => {
  const due = Date.parse("2026-10-28T10:00:20.000Z");
  const armed = Date.parse("2026-10-28T10:00:00.000Z");
  const status = {
    state: "running" as const,
    nextCycleAt: new Date(due).toISOString(),
    nextCycleArmedAt: new Date(armed).toISOString(),
  };

  it("measures the wait from when it was armed to when it is due", () => {
    const state = countdownState(status, armed + 5000);

    expect(state.phase).toBe("countdown");
    expect(state.remainingMs).toBe(15000);
    expect(state.remainingSeconds).toBe(15);
    expect(state.totalMs).toBe(20000);
    expect(state.elapsedFraction).toBeCloseTo(0.25);
  });

  it("rounds the seconds up and stops at zero once due", () => {
    expect(countdownState(status, due - 100).remainingSeconds).toBe(1);
    const late = countdownState(status, due + 3000);
    expect(late.remainingMs).toBe(0);
    expect(late.elapsedFraction).toBe(1);
  });

  it("marks the start delay before the first capture", () => {
    expect(countdownState({ ...status, nextCycleIsFirst: true }, armed).phase).toBe("delay");
  });

  it("falls back to when the countdown was first seen without nextCycleArmedAt", () => {
    const state = countdownState({ ...status, nextCycleArmedAt: undefined }, armed + 10000, armed);
    expect(state.elapsedFraction).toBeCloseTo(0.5);
    expect(countdownState({ ...status, nextCycleArmedAt: undefined }, armed).totalMs).toBeUndefined();
  });

  it("tells generating (running, nothing scheduled) from stopped", () => {
    expect(countdownState({ state: "running" }, armed).phase).toBe("generating");
    expect(countdownState({ state: "paused" }, armed).phase).toBe("stopped");
    expect(countdownState({ state: "idle", nextCycleAt: "garbage" }, armed).phase).toBe("stopped");
  });
});

describe("formatCountdown", () => {
  it("shows seconds below a minute and m:ss above", () => {
    expect(formatCountdown(12)).toEqual({ value: "12", unit: "秒", spoken: "12 秒" });
    expect(formatCountdown(0.2).value).toBe("1");
    expect(formatCountdown(185)).toEqual({ value: "3:05", unit: "", spoken: "3 分 5 秒" });
    expect(formatCountdown(120).spoken).toBe("2 分钟");
  });
});

describe("number formatting", () => {
  it("keeps the old byte and cache formats", () => {
    expect(formatBytes(undefined)).toBe("—");
    expect(formatBytes(2048)).toBe("2 KB");
    expect(formatBytes(3.1 * 1024 * 1024)).toBe("3.10 MB");
    expect(formatCacheUsage(undefined, undefined)).toBe("—");
    expect(formatCacheUsage(undefined, 100)).toBe("? / 100");
    expect(formatCacheUsage(5612, 6840)).toBe("5612 / 6840 (82%)");
  });

  it("formats megabytes for size readouts", () => {
    expect(formatMegabytes(3.1 * 1024 * 1024)).toBe("3.1");
    expect(formatMegabytes(48 * 1024 * 1024)).toBe("48");
    expect(formatMegabytes(512.4 * 1024 * 1024)).toBe("512");
    expect(formatMegabytes(0)).toBe("—");
  });

  it("computes the cached share only when it is known", () => {
    expect(cachePercent(5612, 6840)).toBe(82);
    expect(cachePercent(undefined, 6840)).toBeUndefined();
    expect(cachePercent(10, 0)).toBeUndefined();
    expect(cachePercent(0, 100)).toBe(0);
  });

  it("writes range hints and spans", () => {
    expect(rangeHint(LIMITS.fontSize, "px")).toBe("10 – 96 px");
    expect(rangeHint(LIMITS.opacity, "%", 100)).toBe("20% – 100%");
    expect(rangeHint(LIMITS.captureJpegQuality)).toBe("0.5 – 0.95");
    expect(formatSpan(28, 14)).toBe("14–28 秒");
    expect(formatSpan(18, 18)).toBe("18 秒");
    expect(roundForDisplay(0.92 * 100)).toBe(92);
  });
});

describe("scaled number input", () => {
  it("parses displayed units into clamped stored values", () => {
    expect(parseScaledInput("92", LIMITS.opacity, false, 100)).toBeCloseTo(0.92);
    expect(parseScaledInput("5", LIMITS.opacity, false, 100)).toBe(0.2);
    expect(parseScaledInput("45", LIMITS.timeoutMs, true, 0.001)).toBe(45000);
    expect(parseScaledInput("", LIMITS.opacity, false, 100)).toBeUndefined();
    expect(parseScaledInput("abc", LIMITS.opacity, false, 100)).toBeUndefined();
    expect(parseScaledInput("12", LIMITS.fontSize)).toBe(12);
  });

  it("shows stored values without float noise", () => {
    expect(displayNumber(0.92, 100)).toBe("92");
    expect(displayNumber(45000, 0.001)).toBe("45");
  });

  it("counts characters and lines", () => {
    expect(countText("")).toBe("0 字 · 0 行");
    expect(countText("你好\nab")).toBe("5 字 · 2 行");
  });
});

describe("log helpers", () => {
  it("labels summary entries violet unless they failed", () => {
    expect(logPill(log({ reason: "summary" }))).toEqual({ label: "摘要", tone: "violet" });
    expect(logPill(log({ reason: "summary", status: "error" }))).toEqual({ label: "失败", tone: "bad" });
    expect(logPill(log({ status: "aborted" }))).toEqual({ label: "中断", tone: "warn" });
    expect(logPill(log())).toEqual({ label: "成功", tone: "ok" });
  });

  it("flags cache, truncation, compaction, resizing, recovery and summary length", () => {
    const flags = logFlags(
      log({
        cachedInputTokens: 896,
        promptTokens: 5980,
        finishReason: "length",
        compaction: [
          { trigger: "413", reason: "bytes", droppedImages: 6 },
          { trigger: "budget", reason: "images", droppedImages: 2 },
        ],
        historyRecovery: "reset",
        screen: { enabled: true, captured: true, resizedToFit: true },
      }),
    );

    expect(flags.map((flag) => flag.label)).toEqual([
      "缓存 15%",
      "输出截断",
      "413 后压缩 −8 张",
      "已缩小",
      "失败后清空历史",
    ]);
    expect(logFlags(log({ reason: "summary", summary: "一二三" })).map((flag) => flag.label)).toEqual([
      "3 字",
    ]);
    expect(logFlags(log())).toEqual([]);
  });

  it("keeps the old compaction label", () => {
    expect(
      compactionLabel(
        log({
          compaction: [{ trigger: "budget", reason: "images", droppedImages: 12 }],
          historyRecovery: "images",
        }),
      ),
    ).toBe("超出张数丢弃 12 张；失败后丢弃全部历史截图");
    expect(compactionLabel(log())).toBe("—");
  });

  it("picks the latest comment and compaction entries (logs are newest first)", () => {
    const newest = log({ id: "summary", reason: "summary", comments: [] });
    const failed = log({ id: "failed", status: "error", comments: [] });
    const shown = log({ id: "shown" });
    const compacted = log({ id: "compacted", compaction: [{ trigger: "budget", reason: "images", droppedImages: 4 }] });
    const logs = [newest, failed, shown, compacted];

    expect(latestCommentLog(logs)?.id).toBe("shown");
    expect(latestCompactionLog(logs)?.id).toBe("compacted");
    expect(latestCommentLog([newest])).toBeUndefined();
  });

  it("builds oldest-first series of the last rounds without summaries", () => {
    const logs = [
      log({ id: "3", durationMs: 3000, cachedInputTokens: 90, promptTokens: 100 }),
      log({ id: "s", reason: "summary", durationMs: 9000 }),
      log({ id: "2", durationMs: 2000 }),
      log({ id: "1", durationMs: 1000, cachedInputTokens: 10, promptTokens: 100 }),
    ];

    expect(latencySeries(logs, 2).map((point) => point.value)).toEqual([2000, 3000]);
    expect(cacheSeries(logs).map((point) => point.value)).toEqual([10, undefined, 90]);
  });
});

describe("dirtyPages", () => {
  it("is clean for an unchanged draft and ignores the run flag", () => {
    const config = makeConfig();
    expect(Object.values(dirtyPages(config, makeConfig({ runtime: { enabled: true } })))).toEqual([
      false,
      false,
      false,
      false,
      false,
      false,
    ]);
  });

  it("splits runtime fields between 运行节奏 and 截图与历史", () => {
    const config = makeConfig();

    expect(dirtyPages(config, makeConfig({ runtime: { startDelaySeconds: 9 } }))).toMatchObject({
      rhythm: true,
      capture: false,
    });
    expect(dirtyPages(config, makeConfig({ runtime: { historyRounds: 9 } }))).toMatchObject({
      rhythm: false,
      capture: true,
    });
  });

  it("maps sections to pages (character covers the user too)", () => {
    const config = makeConfig();

    expect(dirtyPages(config, makeConfig({ user: { name: "阿明" } })).character).toBe(true);
    expect(dirtyPages(config, makeConfig({ model: { timeoutMs: 60000 } })).model).toBe(true);
    expect(dirtyPages(config, makeConfig({ danmaku: { palette: ["#fff"] } })).danmaku).toBe(true);
    expect(dirtyPages(config, makeConfig({ prompt: { userTemplate: "x" } })).prompt).toBe(true);
  });
});

describe("pageFromHash", () => {
  it("deep-links known pages and falls back to the overview", () => {
    expect(pageFromHash("#capture")).toBe("capture");
    expect(pageFromHash("#/logs")).toBe("logs");
    expect(pageFromHash("")).toBe("overview");
    expect(pageFromHash("#nope")).toBe("overview");
  });
});
