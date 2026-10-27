import { describe, expect, it } from "vitest";
import {
  arrayLiteralFromKey,
  cachedInputTokens,
  extractUsage,
  parseModelText,
  parseQuotedStringArray,
  sanitize,
  textFromContent,
  truncateText,
} from "../src/electron/main/providers/responseParser";
import { makeConfig } from "./helpers";

describe("parseModelText", () => {
  it("parses the requested JSON shape", () => {
    expect(parseModelText('{"comments":["a","b"]}')).toEqual(["a", "b"]);
  });

  it("parses fenced JSON", () => {
    expect(parseModelText('```json\n{"comments":["one","two"]}\n```')).toEqual(["one", "two"]);
  });

  it("parses a bare array of strings or {text} objects", () => {
    expect(parseModelText('["x", {"text": "y"}, 3]')).toEqual(["x", "y"]);
  });

  it("recovers comments from single-quoted or truncated JSON", () => {
    expect(parseModelText("{'comments': ['甲', '乙']}")).toEqual(["甲", "乙"]);
    expect(parseModelText('{"comments": ["complete", "trunc')).toEqual(["complete"]);
  });

  it("falls back to list lines", () => {
    expect(parseModelText("1. 第一条\n- 第二条\n\n3、第三条")).toEqual(["第一条", "第二条", "第三条"]);
  });
});

describe("helpers", () => {
  it("extracts the comments array literal", () => {
    expect(arrayLiteralFromKey('x {"comments": ["a]", "b"]} y', "comments")).toBe('["a]", "b"]');
    expect(arrayLiteralFromKey("no key here", "comments")).toBeUndefined();
  });

  it("parses quoted strings with escapes", () => {
    expect(parseQuotedStringArray('["a\\"b", \'c\']')).toEqual(['a"b', "c"]);
  });

  it("truncates by code points", () => {
    expect(truncateText("abcdef", 5)).toBe("ab...");
    expect(truncateText("abc", 5)).toBe("abc");
    expect(truncateText("abcdef", 3)).toBe("abc");
  });

  it("reads string and part-array message content", () => {
    expect(textFromContent([{ message: { content: "hi" } }])).toBe("hi");
    expect(textFromContent([{ message: { content: [{ text: "a" }, { text: "b" }] } }])).toBe("a\nb");
    expect(textFromContent(undefined)).toBe("");
  });

  it("reads cached tokens from OpenAI-style usage", () => {
    expect(cachedInputTokens({ usage: { prompt_tokens_details: { cached_tokens: 98 } } })).toBe(98);
    expect(cachedInputTokens({ usage: { input_tokens_details: { cached_tokens: 7 } } })).toBe(7);
    expect(cachedInputTokens({})).toBeUndefined();
  });
});

describe("sanitize", () => {
  it("normalizes whitespace, dedupes against history and caps the count", () => {
    const config = makeConfig({ danmaku: { maxCommentLength: 12 } });
    const items = sanitize(["  hello   world  ", "Hello World", "old", "", "x".repeat(20), "extra"], config, 3, ["OLD"]);
    expect(items.map((item) => item.text)).toEqual(["hello world", "xxxxxxxxx...", "extra"]);
    expect(items[0].color).toBe(config.danmaku.palette[0]);
    expect(items.every((item) => item.source === "model")).toBe(true);
  });
});

describe("extractUsage", () => {
  it("reads Halogen/llama.cpp responses on a cold and a warm request", () => {
    // Shapes observed from llm_api + Halogen: the cached field is absent when nothing was reused.
    const cold = {
      usage: { prompt_tokens: 98, completion_tokens: 2, total_tokens: 100 },
      timings: { prompt_n: 98, cache_n: 0, prompt_ms: 460.2 },
    };
    const warm = {
      usage: { prompt_tokens: 98, completion_tokens: 2, prompt_tokens_details: { cached_tokens: 98 } },
      timings: { prompt_n: 0, cache_n: 98, prompt_ms: 0.3 },
    };
    expect(extractUsage(cold)).toEqual({ promptTokens: 98, completionTokens: 2, cachedTokens: 0, promptMs: 460.2 });
    expect(extractUsage(warm)).toEqual({ promptTokens: 98, completionTokens: 2, cachedTokens: 98, promptMs: 0.3 });
  });

  it("supports other gateway formats and timings-only servers", () => {
    expect(extractUsage({ usage: { prompt_cache_hit_tokens: 5, prompt_tokens: 9 } }).cachedTokens).toBe(5);
    expect(extractUsage({ usage: { cache_read_input_tokens: 7, input_tokens: 11, output_tokens: 3 } })).toMatchObject({
      cachedTokens: 7,
      promptTokens: 11,
      completionTokens: 3,
    });
    expect(extractUsage({ timings: { cache_n: 40, prompt_n: 2 } })).toMatchObject({ cachedTokens: 40, promptTokens: 42 });
    expect(extractUsage({})).toEqual({});
  });
});
