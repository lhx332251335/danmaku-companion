import { describe, expect, it } from "vitest";
import {
  applyConfigPatch,
  deepMerge,
  normalizeConfig,
  normalizeProfileConfig,
  sanitizeConfig,
  serializeState,
  stateFromParsed,
  stateFromText,
  stripRunFlag,
  withRunFlag,
} from "../src/electron/main/configModel";
import { defaultAppConfig } from "../src/shared/defaultConfig";
import { makeConfig } from "./helpers";

describe("deepMerge", () => {
  it("merges nested records, replaces arrays and skips undefined", () => {
    const merged = deepMerge(
      { a: { b: 1, c: 2 }, list: [1, 2], keep: "x" },
      { a: { b: 5 }, list: [3], keep: undefined },
    );
    expect(merged).toEqual({ a: { b: 5, c: 2 }, list: [3], keep: "x" });
  });
});

describe("config normalization", () => {
  it("fills defaults for partial legacy configs", () => {
    const config = normalizeProfileConfig({ model: { model: "custom" } });
    expect(config.model.model).toBe("custom");
    expect(config.runtime).toEqual(defaultAppConfig.runtime);
  });

  it("migrates a single release window into a min/max pair", () => {
    const config = normalizeProfileConfig({ runtime: { releaseWindowSeconds: 4 } });
    expect(config.runtime.releaseWindowMinSeconds).toBe(4);
    expect(config.runtime.releaseWindowMaxSeconds).toBe(4);
  });

  it("moves old default user-template lines into the system template", () => {
    const config = makeConfig({
      prompt: {
        systemTemplate: "You are a bot.",
        userTemplate: "Active app: {{activeApp}}\nReturn only JSON in this shape: {{jsonShape}}\nCustom line",
      },
    });
    const normalized = normalizeConfig(config);
    expect(normalized.prompt.userTemplate).toBe("Custom line");
    expect(normalized.prompt.systemTemplate).toContain("Return only JSON in this shape: {{jsonShape}}");
    expect(normalized.prompt.systemTemplate).toContain("{{requestedCount}}");
  });

  it("returns the same object when nothing needs migrating", () => {
    const config = makeConfig();
    expect(normalizeConfig(config)).toBe(config);
  });
});

describe("stateFromParsed", () => {
  it("reads profile files and falls back to the first profile", () => {
    const state = stateFromParsed({
      activeProfileId: "missing",
      profiles: [{ id: "p1", name: " ", config: { model: { model: "m1" } } }, "junk"],
    });
    expect(state.activeProfileId).toBe("p1");
    expect(state.profiles).toHaveLength(1);
    expect(state.profiles[0].name).toBe("配置 1");
    expect(state.profiles[0].config.model.model).toBe("m1");
  });

  it("wraps a legacy single config into one profile", () => {
    const state = stateFromParsed({ model: { model: "legacy" } });
    expect(state.profiles).toHaveLength(1);
    expect(state.profiles[0].config.model.model).toBe("legacy");
  });

  it("gives repeated or missing profile ids a fresh id", () => {
    const state = stateFromParsed({
      activeProfileId: "p1",
      profiles: [{ id: "p1", name: "A" }, { id: " p1 ", name: "B" }, { name: "C" }],
    });
    const ids = state.profiles.map((profile) => profile.id);
    expect(ids[0]).toBe("p1");
    expect(new Set(ids).size).toBe(3);
    expect(state.activeProfileId).toBe("p1");
  });
});

describe("deepMerge with null", () => {
  it("treats null like undefined", () => {
    const merged = deepMerge({ a: { b: 1 }, c: "x" }, { a: null, c: null } as never);
    expect(merged).toEqual({ a: { b: 1 }, c: "x" });
  });
});

describe("sanitizeConfig", () => {
  it("leaves the default config unchanged", () => {
    expect(sanitizeConfig(defaultAppConfig)).toEqual(defaultAppConfig);
  });

  it("drops unknown keys and replaces values of the wrong type", () => {
    const config = sanitizeConfig({
      extra: 1,
      model: "broken",
      character: { name: 42, persona: "kept" },
      danmaku: { shadow: "yes", palette: "red" },
      runtime: { enabled: 1, privacyBlacklist: [1, "secret", null] },
    });
    expect(config).not.toHaveProperty("extra");
    expect(config.model).toEqual(defaultAppConfig.model);
    expect(config.character.name).toBe(defaultAppConfig.character.name);
    expect(config.character.persona).toBe("kept");
    expect(config.danmaku.shadow).toBe(defaultAppConfig.danmaku.shadow);
    expect(config.danmaku.palette).toEqual(defaultAppConfig.danmaku.palette);
    expect(config.runtime.enabled).toBe(false);
    expect(config.runtime.privacyBlacklist).toEqual(["secret"]);
  });

  it("whitelists enum values", () => {
    const config = sanitizeConfig({
      model: { provider: "other" },
      danmaku: { zone: "left" },
      runtime: { historyMode: "rolling", captureImageFormat: "gif" },
    });
    expect(config.model.provider).toBe("openai-compatible");
    expect(config.danmaku.zone).toBe("full");
    expect(config.runtime.historyMode).toBe("reset-on-limit");
    expect(config.runtime.captureImageFormat).toBe("jpeg");

    const valid = sanitizeConfig({ danmaku: { zone: "top" }, runtime: { historyMode: "batch-sliding" } });
    expect(valid.danmaku.zone).toBe("top");
    expect(valid.runtime.historyMode).toBe("batch-sliding");
  });

  it.each([
    ["model", "timeoutMs", 3, 5000],
    ["model", "timeoutMs", 0, 5000],
    ["model", "timeoutMs", 1e9, 1800000],
    ["model", "timeoutMs", 900000, 900000],
    ["model", "maxTokens", 0, 16],
    ["model", "maxTokens", 100.6, 101],
    ["model", "temperature", -1, 0],
    ["model", "temperature", 5, 2],
    ["danmaku", "fontSize", 2, 10],
    ["danmaku", "fontSize", 60, 60],
    ["danmaku", "opacity", 3, 1],
    ["danmaku", "speedSeconds", 0, 2],
    ["danmaku", "speedSeconds", 40, 40],
    ["danmaku", "density", 0, 0.1],
    ["danmaku", "maxCommentLength", 1000, 200],
    ["runtime", "intervalMinSeconds", 1, 5],
    ["runtime", "startDelaySeconds", 99, 60],
    ["runtime", "itemsPerCycle", 2.4, 2],
    ["runtime", "captureJpegQuality", 2, 0.95],
    ["runtime", "generationLogLimit", 1e6, 2000],
  ] as const)("clamps %s.%s=%s to %s", (section, key, value, expected) => {
    const config = sanitizeConfig({ [section]: { [key]: value } });
    expect((config[section] as unknown as Record<string, number>)[key]).toBe(expected);
  });

  it("uses the fallback config for invalid values", () => {
    const previous = makeConfig({ model: { timeoutMs: 90000 }, danmaku: { palette: ["#000000"] } });
    const config = sanitizeConfig(
      { model: { timeoutMs: Number.NaN }, danmaku: { palette: [] } },
      previous,
    );
    expect(config.model.timeoutMs).toBe(90000);
    expect(config.danmaku.palette).toEqual(["#000000"]);
  });

  it("returns a copy that shares no arrays with its input", () => {
    const input = makeConfig();
    const config = sanitizeConfig(input);
    config.danmaku.palette.push("#123456");
    expect(input.danmaku.palette).toEqual(defaultAppConfig.danmaku.palette);
  });
});

describe("applyConfigPatch", () => {
  const previous = makeConfig({ runtime: { intervalMinSeconds: 30 }, model: { apiKey: "k" } });

  it("ignores null and non-record patches", () => {
    expect(applyConfigPatch(previous, null)).toEqual(previous);
    expect(applyConfigPatch(previous, "broken")).toEqual(previous);
    expect(applyConfigPatch(previous, { runtime: null, model: { apiKey: null } })).toEqual(previous);
  });

  it("keeps the previous section when a patch replaces it with garbage", () => {
    const config = applyConfigPatch(previous, { runtime: "broken", model: { timeoutMs: 3 } });
    expect(config.runtime).toEqual(previous.runtime);
    expect(config.model.apiKey).toBe("k");
    expect(config.model.timeoutMs).toBe(5000);
  });

  it("survives a stored profile with a null template", () => {
    const config = normalizeProfileConfig({ prompt: { userTemplate: null }, runtime: { historyMode: "rolling" } });
    expect(config.prompt.userTemplate).toBe(defaultAppConfig.prompt.userTemplate);
    expect(config.runtime.historyMode).toBe("reset-on-limit");
  });
});

describe("run flag helpers", () => {
  it("strips runtime.enabled from renderer patches without mutating them", () => {
    const patch = { runtime: { enabled: true, historyRounds: 2 }, model: { model: "m" } };
    expect(stripRunFlag(patch)).toEqual({ runtime: { historyRounds: 2 }, model: { model: "m" } });
    expect(patch.runtime.enabled).toBe(true);
    expect(stripRunFlag({ model: { model: "m" } })).toEqual({ model: { model: "m" } });
    expect(stripRunFlag(null)).toEqual({});
    expect(stripRunFlag([1])).toEqual({});
  });

  it("sets the run flag only when it differs", () => {
    const config = makeConfig();
    expect(withRunFlag(config, false)).toBe(config);
    const enabled = withRunFlag(config, true);
    expect(enabled.runtime.enabled).toBe(true);
    expect(config.runtime.enabled).toBe(false);
  });
});

describe("stateFromText", () => {
  it("rejects text that is not a recognizable config", () => {
    expect(stateFromText("")).toBeUndefined();
    expect(stateFromText("{ \"profiles\": [")).toBeUndefined();
    expect(stateFromText("{}")).toBeUndefined();
    expect(stateFromText("[]")).toBeUndefined();
    expect(stateFromText(JSON.stringify({ version: 2, profiles: [] }))).toBeUndefined();
  });

  it("reads profile files with a BOM and legacy flat configs", () => {
    const text = `\uFEFF${JSON.stringify({ activeProfileId: "p1", profiles: [{ id: "p1", name: "A", config: {} }] })}`;
    expect(stateFromText(text)?.activeProfileId).toBe("p1");
    expect(stateFromText(JSON.stringify({ model: { model: "legacy" } }))?.profiles[0].config.model.model).toBe(
      "legacy",
    );
  });

  it("round-trips serialized state unchanged", () => {
    const state = stateFromParsed({
      activeProfileId: "p1",
      profiles: [{ id: "p1", name: "A", config: {}, createdAt: "t1", updatedAt: "t2" }],
    });
    const text = serializeState(state);
    const reread = stateFromText(text);
    expect(reread && serializeState(reread)).toBe(text);
  });
});
