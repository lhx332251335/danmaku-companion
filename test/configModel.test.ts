import { describe, expect, it } from "vitest";
import {
  deepMerge,
  normalizeConfig,
  normalizeProfileConfig,
  stateFromParsed,
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
});
