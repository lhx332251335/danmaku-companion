import { describe, expect, it } from "vitest";
import {
  arrayLiteralFromKey,
  cachedInputTokens,
  dedupeKey,
  extractUsage,
  parseModelText,
  parseQuotedStringArray,
  readCompletion,
  sanitize,
  stripReasoning,
  textFromContent,
  truncateText,
  type ChatCompletionResponse,
} from "../src/electron/main/providers/responseParser";
import { makeConfig } from "./helpers";

describe("parseModelText", () => {
  it("parses the requested JSON shape", () => {
    expect(parseModelText('{"comments":["a","b"]}')).toEqual(["a", "b"]);
  });

  it("parses fenced JSON", () => {
    expect(parseModelText('```json\n{"comments":["one","two"]}\n```')).toEqual(["one", "two"]);
  });

  it("parses a bare array of strings, numbers or {text} objects", () => {
    expect(parseModelText('["x", {"text": "y"}, 3]')).toEqual(["x", "y", "3"]);
  });

  it("recovers comments from single-quoted or truncated JSON", () => {
    expect(parseModelText("{'comments': ['甲', '乙']}")).toEqual(["甲", "乙"]);
    expect(parseModelText('{"comments": ["complete", "trunc')).toEqual(["complete"]);
  });

  it("falls back to list lines", () => {
    expect(parseModelText("1. 第一条\n- 第二条\n\n3、第三条")).toEqual(["第一条", "第二条", "第三条"]);
  });

  it.each([
    ["truncated object", '{\n  "comments": [', []],
    ["truncated fenced object", '```json\n{\n  "comments": [\n', []],
    ["truncated bare array", '[\n"a",\n"b', ["a"]],
    ["truncated object items", '{"comments":[{"text":"a"},{"te', []],
    ["escapes in truncated JSON", '{"comments": ["a\\nb", "\\u4f60\\u597d", "trunc', ["a\nb", "你好"]],
    ["another array key", '{"danmaku":["a","b"]}', ["a", "b"]],
    ["empty object", "{}", []],
    ["empty array", '{"comments":[]}', []],
    ["string instead of array", '{"comments":"single string"}', ["single string"]],
    ["object items", '{"comments":[{"text":"a"},{"content":"b"},{"comment":"c"}]}', ["a", "b", "c"]],
    ["null and number items", '{"comments":[null,1,"x"]}', ["1", "x"]],
    ["the prompt example", '{"comments":["comment 1","comment 2"]}', []],
    ["JSON inside prose", '好的：{"comments":["甲","乙"]} 希望喜欢', ["甲", "乙"]],
    ["fence after a preamble", 'Here you go:\n```\n["a","b"]\n```', ["a", "b"]],
    ["fence on one line", '```json{"comments":["a"]}```', ["a"]],
    ["a stray closing fence", '{"comments":["a"]}\n```', ["a"]],
  ])("never shows JSON markup: %s", (_name, raw, expected) => {
    expect(parseModelText(raw)).toEqual(expected);
  });

  it.each([
    ["numbers that are comments", "1. 2024年真好\n2. 3D效果\n- -5度", ["2024年真好", "3D效果", "-5度"]],
    ["a preamble line", "好的，我来生成弹幕：\n1. 这画面绝了\n2. 666", ["这画面绝了", "666"]],
    ["bare numbers", "666", ["666"]],
    ["a long digit run", "6666666666666666666666", ["6666666666666666666666"]],
    ["decimals and parenthesized markers", "1.5倍速看完了\n(2) 好\n[3] 妙", ["1.5倍速看完了", "好", "妙"]],
    ["bracketed emoticons", "[狗头]这也行\n第[3]关好难", ["[狗头]这也行", "第[3]关好难"]],
    ["quoted lines", '"甲",\n「乙」\n“好”和“坏”', ["甲", "乙", "“好”和“坏”"]],
  ])("keeps comment text in the line fallback: %s", (_name, raw, expected) => {
    expect(parseModelText(raw)).toEqual(expected);
  });

  it("ignores inline reasoning, including the example shape quoted inside it", () => {
    const raw =
      '<think>The required shape is {"comments":["comment 1","comment 2"]}...</think>\n{"comments":["这关好难","boss来了","冲冲冲"]}';
    expect(parseModelText(raw)).toEqual(["这关好难", "boss来了", "冲冲冲"]);
    expect(parseModelText('<think>\n\n</think>\n\n["a","b"]')).toEqual(["a", "b"]);
    expect(parseModelText("<think>only reasoning, truncated")).toEqual([]);
  });
});

describe("stripReasoning", () => {
  it.each([
    ["<think>x</think>\n\nanswer", "answer"],
    ["<THINK>x</THINK>answer", "answer"],
    ["<thinking>a</thinking>b<think>c</think>d", "bd"],
    ["template opened the tag</think>\nanswer", "answer"],
    ["answer<think>cut off", "answer"],
    ["<think>cut off", ""],
    ["no reasoning", "no reasoning"],
  ])("%j -> %j", (raw, expected) => {
    expect(stripReasoning(raw)).toBe(expected);
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

  it("truncates by grapheme with an ellipsis", () => {
    expect(truncateText("abcdef", 5)).toBe("abcd…");
    expect(truncateText("abc", 5)).toBe("abc");
    expect(truncateText("abcdef", 3)).toBe("ab…");
    expect(truncateText("ab  cdef", 4)).toBe("ab…");
    expect(truncateText("🇨🇳🇯🇵🇺🇸🇬🇧🇫🇷", 3)).toBe("🇨🇳🇯🇵…");
    expect(truncateText("👨‍👩‍👧‍👦👍🏽abc", 3)).toBe("👨‍👩‍👧‍👦👍🏽…");
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
    expect(items.map((item) => item.text)).toEqual(["hello world", "xxxxxxxxxxx…", "extra"]);
    expect(items[0].color).toBe(config.danmaku.palette[0]);
    expect(items.every((item) => item.source === "model")).toBe(true);
  });

  it("catches repeats of history before and after truncation", () => {
    const config = makeConfig({ danmaku: { maxCommentLength: 10 } });
    const long = "一二三四五六七八九十十一十二";
    const texts = (items: string[], history: string[]) =>
      sanitize(items, config, 5, history).map((item) => item.text);
    expect(texts([long], [long])).toEqual([]);
    expect(texts([`${long}十三`], [long])).toEqual([]);
    expect(texts(["好 看", "好 看！", "ＯＫ😂"], ["好  看", "ok"])).toEqual([]);
    expect(texts(["？？？", "😂", "！！！"], [])).toEqual(["？？？", "😂", "！！！"]);
  });

  it("builds dedupe keys", () => {
    expect(dedupeKey("ＡＢＣ  Def!!")).toBe("abc def");
    expect(dedupeKey("好看❤️")).toBe("好看");
    expect(dedupeKey("？？")).toBe("??");
  });
});

describe("readCompletion", () => {
  const completion = (
    content: string | null,
    finishReason = "stop",
    message: Record<string, unknown> = {},
  ): ChatCompletionResponse => ({
    choices: [{ finish_reason: finishReason, message: { content, ...message } }],
  });

  it("returns the comments and keeps reasoning out of the history text", () => {
    const result = readCompletion(completion('<think>hmm</think>\n{"comments":["甲"]}'), 260);
    expect(result).toEqual({
      text: '{"comments":["甲"]}',
      rawText: '<think>hmm</think>\n{"comments":["甲"]}',
      comments: ["甲"],
      finishReason: "stop",
    });
  });

  it("keeps the comments that were complete when the output was cut off", () => {
    const cut = completion('{"comments":["这只猫也太可爱了吧！","小猫咪能', "length", {
      reasoning_content: "short",
    });
    expect(readCompletion(cut, 40).comments).toEqual(["这只猫也太可爱了吧！"]);
  });

  it("accepts an explicit empty list", () => {
    expect(readCompletion(completion('{"comments":[]}'), 260).comments).toEqual([]);
  });

  it.each([
    ["reasoning used up max_tokens", completion("", "length", { reasoning_content: "We need" }), /思考过程用完了 max_tokens（260）.*no-think/],
    ["inline reasoning used up max_tokens", completion("<think>We need to", "length"), /思考过程用完了 max_tokens（260）/],
    ["answer cut before the first comment", completion('{"comments": ["trunc', "length"), /max_tokens（260）处被截断/],
    ["empty content", completion(null), /空内容（finish_reason=stop）/],
    ["reasoning only", completion("<think>a</think>", "stop"), /只输出了思考过程/],
    ["no choices", {}, /没有 choices/],
    ["a null body", null, /没有 choices/],
    ["an error object in a 200 body", { error: { message: "model not loaded", type: "server_error" } }, /模型服务返回了错误：model not loaded/],
    ["a string error", { error: "overloaded", choices: [] }, /overloaded/],
  ])("throws for %s", (_name, response, message) => {
    expect(() => readCompletion(response as ChatCompletionResponse, 260)).toThrow(message);
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
