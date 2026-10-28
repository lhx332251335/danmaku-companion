import { describe, expect, it } from "vitest";
import type { GenerationLogEntry } from "../src/shared/types";
import {
  formatClock,
  formatCount,
  formatDuration,
  formatMonthDay,
  formatSecondsValue,
  isFailedLog,
  isSummaryLog,
  medianLatency,
  paletteColor,
  parsePalette,
  recentRounds,
  screenLabel,
  shorten,
} from "../src/renderer/settings/format";
import { pageFromHash, pageMeta, PAGES } from "../src/renderer/settings/constants";
import { ZONE_BANDS } from "../src/renderer/overlay/lanes";

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
    comments: ["a"],
    ...overrides,
  };
}

describe("number and time formatting", () => {
  it("formats durations with a spaced unit", () => {
    expect(formatDuration(412)).toBe("412 ms");
    expect(formatDuration(412.6)).toBe("413 ms");
    expect(formatDuration(2410)).toBe("2.4 s");
    expect(formatDuration(undefined)).toBe("—");
    expect(formatDuration(Number.NaN)).toBe("—");
  });

  it("formats counts and seconds", () => {
    expect(formatCount(5612)).toBe("5,612");
    expect(formatCount(undefined)).toBe("—");
    expect(formatSecondsValue(2410)).toBe("2.41");
    expect(formatSecondsValue(2410, 1)).toBe("2.4");
    expect(formatSecondsValue(undefined)).toBe("—");
  });

  it("formats clock and month-day in local time", () => {
    const local = new Date(2026, 9, 5, 7, 3, 9).toISOString();
    expect(formatClock(local)).toBe("07:03:09");
    expect(formatMonthDay(local)).toBe("10-05");
    expect(formatClock(undefined)).toBe("—");
    expect(formatClock("not a date")).toBe("—");
    expect(formatMonthDay("")).toBe("—");
  });

  it("shortens by code points", () => {
    expect(shorten("  短句  ")).toBe("短句");
    expect(shorten("这关的 BGM 也太燃了吧")).toBe("这关的 BGM…");
    expect(shorten("😀😀😀😀", 3)).toBe("😀😀…");
  });
});

describe("log helpers", () => {
  it("labels the screen of a log", () => {
    expect(screenLabel(log())).toBe("960×540");
    expect(screenLabel(log({ screen: { enabled: false, captured: false } }))).toBe("无截图");
    expect(screenLabel(log({ screen: { enabled: true, captured: false } }))).toBe("截图失败");
  });

  it("classifies summary and failed logs", () => {
    expect(isSummaryLog(log({ reason: "summary" }))).toBe(true);
    expect(isSummaryLog(log())).toBe(false);
    expect(isFailedLog(log({ status: "error" }))).toBe(true);
    expect(isFailedLog(log({ status: "aborted" }))).toBe(false);
  });

  it("returns recent rounds oldest first without summaries", () => {
    const logs = [log({ id: "c" }), log({ id: "s", reason: "summary" }), log({ id: "b" }), log({ id: "a" })];
    expect(recentRounds(logs, 2).map((entry) => entry.id)).toEqual(["b", "c"]);
    expect(recentRounds(logs).map((entry) => entry.id)).toEqual(["a", "b", "c"]);
  });

  it("takes the median of recent successful rounds", () => {
    expect(medianLatency([])).toBeUndefined();
    expect(
      medianLatency([
        log({ durationMs: 3000 }),
        log({ durationMs: 9000, reason: "summary" }),
        log({ durationMs: 8000, status: "error" }),
        log({ durationMs: 1000 }),
        log({ durationMs: 2000 }),
      ]),
    ).toBe(2000);
    expect(medianLatency([log({ durationMs: 1000 }), log({ durationMs: 2000 })])).toBe(1500);
    expect(medianLatency([log({ durationMs: 1000 }), log({ durationMs: 5000 })], 1)).toBe(1000);
  });
});

describe("palette", () => {
  it("parses comma lists and cycles colours", () => {
    expect(parsePalette("#fff, #000")).toEqual(["#fff", "#000"]);
    expect(parsePalette(" , ")).toBeUndefined();
    expect(paletteColor(["#a", "#b"], 3)).toBe("#b");
    expect(paletteColor([], 0)).toBe("#f8fafc");
  });
});

describe("pages and zones", () => {
  it("resolves page meta and ignores sub-hashes", () => {
    expect(pageFromHash("#prompt/summary")).toBe("prompt");
    expect(pageFromHash("#capture?x=1")).toBe("capture");
    for (const page of PAGES) {
      expect(pageMeta(page.id).title.length).toBeGreaterThan(0);
    }
  });

  it("keeps every zone band inside the screen", () => {
    for (const [low, high] of Object.values(ZONE_BANDS)) {
      expect(low).toBeGreaterThanOrEqual(0);
      expect(high).toBeLessThanOrEqual(1);
      expect(high).toBeGreaterThan(low);
    }
  });
});
