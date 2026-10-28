/// <reference path="../src/renderer/vite-env.d.ts" />
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../src/renderer/api";
import { buildPreviewData, previewScenario } from "../src/renderer/previewData";
import type { RuntimeStatus } from "../src/shared/types";

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("previewScenario", () => {
  it("reads ?demo= and ignores unknown values", () => {
    expect(previewScenario("?demo=delay")).toBe("delay");
    expect(previewScenario("?view=settings&demo=error")).toBe("error");
    expect(previewScenario("?demo=nope")).toBeUndefined();
    expect(previewScenario("")).toBeUndefined();
  });
});

describe("buildPreviewData", () => {
  const now = Date.parse("2026-10-28T12:00:00.000Z");

  it("describes a running session with a live countdown and every kind of log row", () => {
    const data = buildPreviewData("running", now);
    const { status, logs } = data;

    expect(status).toMatchObject({ state: "running", cycles: 37, providerLatencyMs: 2410 });
    expect(Date.parse(status.nextCycleAt ?? "")).toBeGreaterThan(now);
    expect(Date.parse(status.nextCycleArmedAt ?? "")).toBeLessThan(now);
    expect(status.contextSummary?.length).toBeGreaterThan(250);
    expect(logs.length).toBeGreaterThanOrEqual(36);
    expect(logs.every((log, index) => index === 0 || log.completedAt <= logs[index - 1].completedAt)).toBe(true);
    expect(Date.parse(logs[logs.length - 1].completedAt)).toBeGreaterThan(now - 3600_000);
    expect(logs.filter((log) => log.reason === "summary" && log.summary)).toHaveLength(2);
    expect(logs.some((log) => log.finishReason === "length")).toBe(true);
    expect(logs.some((log) => log.compaction?.[0].trigger === "budget")).toBe(true);
    expect(logs.some((log) => log.compaction?.[0].trigger === "413")).toBe(true);
    expect(logs.some((log) => log.status === "error" && log.historyRecovery)).toBe(true);
    expect(logs.some((log) => log.status === "aborted")).toBe(true);
    expect(data.profiles).toHaveLength(3);
    expect(data.models.filter((model) => model.vision)).toHaveLength(1);
    expect(data.profiles[0].config.runtime.historySummaryEnabled).toBe(true);
  });

  it("covers the other states", () => {
    expect(buildPreviewData("delay", now).status).toMatchObject({
      state: "running",
      cycles: 0,
      nextCycleIsFirst: true,
    });
    expect(buildPreviewData("paused", now).status.nextCycleAt).toBeUndefined();
    const idle = buildPreviewData("idle", now);
    expect(idle.logs).toEqual([]);
    expect(idle.status).toEqual({ state: "idle", cycles: 0 });
    expect(buildPreviewData("error", now).status.lastError).toContain("413");
  });
});

describe("api preview mock with ?demo", () => {
  function stubDemo(search: string) {
    vi.stubGlobal("window", {
      location: { search },
      setTimeout: (callback: () => void, ms: number) => setTimeout(callback, ms),
      clearTimeout: (handle: ReturnType<typeof setTimeout>) => clearTimeout(handle),
    });
    vi.stubGlobal("navigator", { userAgent: BROWSER_UA });
  }

  it("serves the sample data and re-arms the countdown after each timed round", async () => {
    vi.useFakeTimers();
    stubDemo("?demo=running");
    const bridge = api();
    const statuses: RuntimeStatus[] = [];
    bridge.onRuntimeStatus((status) => statuses.push(status));

    expect((await bridge.getGenerationLogs()).length).toBeGreaterThan(30);
    expect((await bridge.listModels()).models).toHaveLength(3);
    expect((await bridge.getConfigProfiles()).profiles).toHaveLength(3);
    const before = await bridge.getRuntimeStatus();

    await vi.advanceTimersByTimeAsync(20_000);

    const latest = statuses[statuses.length - 1];
    expect(latest.cycles).toBe(before.cycles + 1);
    expect(latest.nextCycleAt).toBeDefined();
    expect(latest.nextCycleIsFirst).toBeUndefined();
  });

  it("starts with the start delay and stops cleanly", async () => {
    vi.useFakeTimers();
    stubDemo("?demo=idle");
    const bridge = api();

    const started = await bridge.start();
    expect(started).toMatchObject({ state: "running", nextCycleIsFirst: true });
    const stopped = await bridge.stop();
    expect(stopped.state).toBe("paused");
    expect(stopped.nextCycleAt).toBeUndefined();
  });
});
