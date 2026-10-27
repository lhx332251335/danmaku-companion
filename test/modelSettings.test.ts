import { describe, expect, it } from "vitest";
import { buildRequestBody } from "../src/electron/main/providers/messageBuilder";
import { normalizedMaxTokens, normalizedTimeoutMs } from "../src/electron/main/providers/modelSettings";
import { makeConfig } from "./helpers";

describe("model settings at use", () => {
  it.each([
    [45_000, 45_000],
    [0, 45_000],
    [-1, 45_000],
    [Number.NaN, 45_000],
    ["", 45_000],
    [1, 5_000],
    [12_345.6, 12_346],
    [10_000_000, 600_000],
  ])("timeoutMs %j -> %j", (value, expected) => {
    expect(normalizedTimeoutMs(makeConfig({ model: { timeoutMs: value as number } }))).toBe(expected);
  });

  it.each([
    [260, 260],
    [0, 260],
    [Number.POSITIVE_INFINITY, 260],
    [undefined, 260],
    [3, 16],
    [100_000, 32_768],
  ])("maxTokens %j -> %j", (value, expected) => {
    expect(normalizedMaxTokens(makeConfig({ model: { maxTokens: value as number } }))).toBe(expected);
  });

  it("sends the clamped max_tokens", () => {
    const config = makeConfig({ model: { maxTokens: 0 } });
    const { body } = buildRequestBody({ character: config.character, maxItems: 3 }, config);
    expect(body.max_tokens).toBe(260);
  });
});
