import { describe, expect, it } from "vitest";
import { LIMITS } from "../src/shared/limits";
import type { RuntimeStatus } from "../src/shared/types";
import {
  PALETTE_MAX_COLORS,
  describeError,
  isDraftDirty,
  parseListInput,
  parseNumberInput,
  parsePaletteInput,
  rebaseDraft,
  shouldReloadLogs,
  toConfigPatch,
} from "../src/renderer/settingsModel";
import { makeConfig } from "./helpers";

describe("toConfigPatch", () => {
  it("leaves out the run flag that main owns", () => {
    const draft = makeConfig({ runtime: { enabled: true, intervalMinSeconds: 20 } });

    const patch = toConfigPatch(draft);

    expect(patch.runtime).not.toHaveProperty("enabled");
    expect(patch.runtime?.intervalMinSeconds).toBe(20);
    expect(patch.model).toEqual(draft.model);
    expect(draft.runtime.enabled).toBe(true);
  });
});

describe("isDraftDirty", () => {
  it("is false for an unchanged draft", () => {
    expect(isDraftDirty(makeConfig(), makeConfig())).toBe(false);
  });

  it("ignores the run flag", () => {
    const config = makeConfig({ runtime: { enabled: false } });
    const draft = makeConfig({ runtime: { enabled: true } });

    expect(isDraftDirty(config, draft)).toBe(false);
  });

  it("detects an edited field, including list fields", () => {
    const config = makeConfig();

    expect(isDraftDirty(config, makeConfig({ model: { timeoutMs: 60000 } }))).toBe(true);
    expect(isDraftDirty(config, makeConfig({ danmaku: { palette: ["#fff"] } }))).toBe(true);
  });

  it("does not depend on key order", () => {
    const config = makeConfig();
    const { baseUrl, ...rest } = config.model;
    const reordered = { ...config, model: { ...rest, baseUrl } };

    expect(isDraftDirty(config, reordered)).toBe(false);
  });
});

describe("rebaseDraft", () => {
  it("takes the new config when nothing was edited", () => {
    const previous = makeConfig();
    const next = makeConfig({ runtime: { enabled: true }, model: { model: "other" } });

    expect(rebaseDraft(previous, next, previous)).toEqual(next);
  });

  it("keeps edited fields and takes untouched ones from the new config", () => {
    const previous = makeConfig();
    const draft = makeConfig({ prompt: { systemTemplate: "edited" } });
    const next = makeConfig({ model: { baseUrl: "http://example.test/v1" } });

    const rebased = rebaseDraft(previous, next, draft);

    expect(rebased.prompt.systemTemplate).toBe("edited");
    expect(rebased.model.baseUrl).toBe("http://example.test/v1");
    expect(isDraftDirty(next, rebased)).toBe(true);
  });

  it("always follows the new run flag", () => {
    const previous = makeConfig({ runtime: { enabled: true } });
    const draft = makeConfig({ runtime: { enabled: true }, character: { name: "Edited" } });
    const next = makeConfig({ runtime: { enabled: false } });

    const rebased = rebaseDraft(previous, next, draft);

    expect(rebased.runtime.enabled).toBe(false);
    expect(rebased.character.name).toBe("Edited");
  });

  it("adopts values main normalized when rebasing on the draft that was sent", () => {
    const sent = makeConfig({ prompt: { systemTemplate: "short" } });
    const saved = makeConfig({ prompt: { systemTemplate: "short\nnormalized" } });

    const rebased = rebaseDraft(sent, saved, sent);

    expect(rebased).toEqual(saved);
    expect(isDraftDirty(saved, rebased)).toBe(false);
  });

  it("keeps edits typed while a save was in flight", () => {
    const sent = makeConfig({ character: { name: "Sent" } });
    const current = makeConfig({ character: { name: "Sent", tone: "typed later" } });
    const saved = makeConfig({ character: { name: "Sent" } });

    const rebased = rebaseDraft(sent, saved, current);

    expect(rebased.character.tone).toBe("typed later");
    expect(isDraftDirty(saved, rebased)).toBe(true);
  });
});

describe("parseNumberInput", () => {
  it("returns undefined for empty or unfinished input instead of 0 or NaN", () => {
    expect(parseNumberInput("", LIMITS.timeoutMs)).toBeUndefined();
    expect(parseNumberInput("   ", LIMITS.timeoutMs)).toBeUndefined();
    expect(parseNumberInput("-", LIMITS.timeoutMs)).toBeUndefined();
    expect(parseNumberInput("abc", LIMITS.timeoutMs)).toBeUndefined();
  });

  it("clamps to the range", () => {
    expect(parseNumberInput("0", LIMITS.timeoutMs)).toBe(LIMITS.timeoutMs.min);
    expect(parseNumberInput("45", LIMITS.timeoutMs)).toBe(LIMITS.timeoutMs.min);
    expect(parseNumberInput("99", LIMITS.opacity)).toBe(1);
    expect(parseNumberInput("0", LIMITS.temperature)).toBe(0);
  });

  it("rounds integer fields and keeps decimals otherwise", () => {
    expect(parseNumberInput("3.6", LIMITS.itemsPerCycle, true)).toBe(4);
    expect(parseNumberInput("0.85", LIMITS.opacity)).toBe(0.85);
    expect(parseNumberInput("4.5e4", LIMITS.timeoutMs, true)).toBe(45000);
  });
});

describe("parseListInput", () => {
  it("accepts trailing and Chinese commas and drops empty or repeated items", () => {
    expect(parseListInput("WeChat, 1Password,")).toEqual(["WeChat", "1Password"]);
    expect(parseListInput("a，b , a")).toEqual(["a", "b"]);
    expect(parseListInput("  ")).toEqual([]);
  });

  it("caps the number of items", () => {
    expect(parseListInput("a,b,c", 2)).toEqual(["a", "b"]);
  });
});

describe("parsePaletteInput", () => {
  const isHex = (value: string) => /^#[0-9a-f]{3,8}$/i.test(value);

  it("keeps only valid colours", () => {
    expect(parsePaletteInput("#f8fafc, #f8fafc#00ff00, #00ff00,", isHex)).toEqual([
      "#f8fafc",
      "#00ff00",
    ]);
  });

  it("never returns an empty palette", () => {
    expect(parsePaletteInput("", isHex)).toBeUndefined();
    expect(parsePaletteInput("nope, #zz", isHex)).toBeUndefined();
  });

  it("caps the palette size", () => {
    const raw = Array.from({ length: 12 }, (_, index) => `#00000${index.toString(16)}`).join(",");

    expect(parsePaletteInput(raw, isHex)).toHaveLength(PALETTE_MAX_COLORS);
  });
});

describe("describeError", () => {
  it("strips the IPC wrapper Electron adds", () => {
    const error = new Error(
      "Error invoking remote method 'config:update': Error: EPERM: operation not permitted, rename 'config.json'",
    );

    expect(describeError(error)).toBe("EPERM: operation not permitted, rename 'config.json'");
  });

  it("keeps plain messages and handles non-errors", () => {
    expect(describeError(new Error("Config profile not found."))).toBe("Config profile not found.");
    expect(describeError("boom")).toBe("boom");
    expect(describeError(undefined)).toBe("未知错误");
    expect(describeError(new Error(""))).toBe("未知错误");
  });
});

describe("shouldReloadLogs", () => {
  const base: RuntimeStatus = {
    state: "running",
    cycles: 3,
    lastGeneratedAt: "2026-01-01T00:00:00.000Z",
  };

  it("reloads when a generation finished", () => {
    expect(
      shouldReloadLogs(base, { ...base, cycles: 4, lastGeneratedAt: "2026-01-01T00:00:20.000Z" }),
    ).toBe(true);
  });

  it("reloads on every error broadcast, even when the message repeats", () => {
    const failed = { ...base, lastError: "fetch failed" };

    expect(shouldReloadLogs(failed, failed)).toBe(true);
  });

  it("reloads when the state changes", () => {
    expect(shouldReloadLogs(base, { ...base, state: "paused" })).toBe(true);
  });

  it("skips broadcasts that add no log entry", () => {
    expect(shouldReloadLogs(base, { ...base })).toBe(false);
    expect(
      shouldReloadLogs(
        { ...base, cachedInputTokens: 100, promptTokens: 200 },
        { ...base, cachedInputTokens: undefined, promptTokens: undefined },
      ),
    ).toBe(false);
  });
});
