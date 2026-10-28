import { afterEach, describe, expect, it, vi } from "vitest";
import { RequestTooLargeError } from "../src/electron/main/providers/errors";
import {
  OpenAICompatibleProvider,
  listOpenAICompatibleModels,
  testOpenAICompatibleConnection,
} from "../src/electron/main/providers/openAiCompatibleProvider";
import { makeConfig, makeSnapshot } from "./helpers";

const config = makeConfig({ model: { baseUrl: "http://llm.test/v1", model: "m" } });
const input = { character: config.character, maxItems: 3 };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("OpenAICompatibleProvider", () => {
  it("refuses to send a body over maxBodyBytes", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const error = await new OpenAICompatibleProvider()
      .generateDanmaku({ ...input, snapshot: makeSnapshot(50_000), maxBodyBytes: 10_000 }, config)
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(RequestTooLargeError);
    expect((error as RequestTooLargeError).fromServer).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("maps HTTP 413 to RequestTooLargeError with the server body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("exceeds max_body of 67108864", { status: 413 })),
    );
    const error = await new OpenAICompatibleProvider()
      .generateDanmaku({ ...input, snapshot: makeSnapshot(1000) }, config)
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(RequestTooLargeError);
    expect((error as RequestTooLargeError).fromServer).toBe(true);
    expect((error as RequestTooLargeError).serverBody).toContain("67108864");
    expect((error as RequestTooLargeError).requestBytes).toBeGreaterThan(1000);
  });

  it("returns comments, usage and the request size", async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      expect(JSON.parse(String(init.body)).model).toBe("m");
      return Response.json({
        choices: [{ message: { content: '{"comments":["一","二"]}' } }],
        usage: { prompt_tokens: 10, completion_tokens: 4 },
        timings: { cache_n: 6, prompt_n: 4, prompt_ms: 12 },
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const result = await new OpenAICompatibleProvider().generateDanmaku(input, config);
    expect(fetchMock.mock.calls[0][0]).toBe("http://llm.test/v1/chat/completions");
    expect(result.items.map((item) => item.text)).toEqual(["一", "二"]);
    expect(result).toMatchObject({ promptTokens: 10, cachedInputTokens: 6, completionTokens: 4, promptMs: 12 });
    expect(result.requestBytes).toBe(Buffer.byteLength(String(fetchMock.mock.calls[0][1].body)));
  });

  it("keeps inline reasoning out of the history text but returns it as raw output", async () => {
    const content = '<think>look at the screen</think>\n{"comments":["甲","乙"]}';
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ choices: [{ finish_reason: "stop", message: { content } }] })),
    );
    const result = await new OpenAICompatibleProvider().generateDanmaku(input, config);
    expect(result.items.map((item) => item.text)).toEqual(["甲", "乙"]);
    expect(result.assistantText).toBe('{"comments":["甲","乙"]}');
    expect(result.rawOutput).toBe(content);
    expect(result.finishReason).toBe("stop");
  });

  it("fails with an actionable message when reasoning used up max_tokens", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          choices: [{ finish_reason: "length", message: { content: "", reasoning_content: "We need" } }],
        }),
      ),
    );
    await expect(new OpenAICompatibleProvider().generateDanmaku(input, config)).rejects.toThrow(
      /max_tokens（260）/,
    );
  });
});

describe("OpenAICompatibleProvider.generateSummary", () => {
  it("returns the summary text with usage", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        choices: [{ finish_reason: "stop", message: { content: "<think>hmm</think>\n用户在打游戏，刚输了一局。" } }],
        usage: { prompt_tokens: 900, completion_tokens: 30 },
        timings: { cache_n: 880, prompt_n: 20, prompt_ms: 15 },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const result = await new OpenAICompatibleProvider().generateSummary(input, config, 200);
    expect(result).toMatchObject({
      text: "用户在打游戏，刚输了一局。",
      cachedInputTokens: 880,
      promptTokens: 900,
      finishReason: "stop",
    });
    expect(result.rawOutput).toContain("<think>");
  });

  it("reads a JSON summary and rejects a danmaku-shaped reply", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ choices: [{ message: { content: '```json\n{"summary":"在看番"}\n```' } }] })));
    await expect(new OpenAICompatibleProvider().generateSummary(input, config, 200)).resolves.toMatchObject({
      text: "在看番",
    });

    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ choices: [{ message: { content: '{"comments":["哈哈"]}' } }] })));
    await expect(new OpenAICompatibleProvider().generateSummary(input, config, 200)).rejects.toThrow("弹幕格式");
  });

  it("caps an overlong summary at twice the requested length", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ choices: [{ message: { content: "长".repeat(500) } }] })));
    const result = await new OpenAICompatibleProvider().generateSummary(input, config, 100);
    expect(result.text.length).toBeLessThanOrEqual(200);
  });

  it("drops the history screenshots when the summary request would be too large", async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) =>
      Response.json({ choices: [{ message: { content: "摘要" } }] }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const history = [{ userText: "", assistantText: '{"comments":["a"]}', snapshot: makeSnapshot(50_000) }];
    const result = await new OpenAICompatibleProvider().generateSummary(
      { ...input, history, maxBodyBytes: 20_000 },
      config,
      200,
    );
    expect(result.text).toBe("摘要");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const sent = String(fetchMock.mock.calls[0][1].body);
    expect(sent).not.toContain("image_url");
    expect(result.requestBytes).toBeLessThan(20_000);
    expect(result.historyImagesSent).toBe(0);
  });
});

describe("listOpenAICompatibleModels", () => {
  it("probes LM Studio and the standard list in parallel and merges them in a fixed order", async () => {
    const pending: Array<() => void> = [];
    const bodies: Record<string, unknown> = {
      "http://llm.test/api/v1/models": {
        models: [{ key: "vl", display_name: "VL", type: "vlm", capabilities: { vision: true }, loaded_instances: [{ id: "vl" }] }],
      },
      "http://llm.test/api/v0/models": { data: [{ id: "text", type: "llm", state: "not-loaded" }] },
      "http://llm.test/v1/models": { data: [{ id: "text" }, { id: "vl" }] },
    };
    const fetchMock = vi.fn(
      (url: string) =>
        new Promise<Response>((resolve) => {
          pending.push(() => resolve(Response.json(bodies[url])));
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = listOpenAICompatibleModels(config);
    await Promise.resolve();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    pending.reverse().forEach((resolve) => resolve());

    const list = await result;
    expect(list.ok).toBe(true);
    expect(list.models).toEqual([
      { id: "vl", name: "VL", state: "loaded", type: "vlm", vision: true },
      { id: "text", name: undefined, state: "not-loaded", type: "llm", vision: false },
    ]);
  });

  it("only asks the standard endpoint when the base is not an LM Studio /v1 API", async () => {
    const fetchMock = vi.fn(async () => Response.json({ data: [{ id: "a" }] }));
    vi.stubGlobal("fetch", fetchMock);
    const list = await listOpenAICompatibleModels(
      makeConfig({ model: { baseUrl: "https://gw.test/v1beta/openai" } }),
    );
    expect(fetchMock.mock.calls.map((call) => (call as unknown[])[0])).toEqual(["https://gw.test/v1beta/openai/models"]);
    expect(list.models.map((model) => model.id)).toEqual(["a"]);
  });

  it("reports an invalid base URL instead of throwing", async () => {
    const bad = makeConfig({ model: { baseUrl: "localhost:1234" } });
    await expect(listOpenAICompatibleModels(bad)).resolves.toMatchObject({ ok: false, models: [] });
    await expect(testOpenAICompatibleConnection(bad)).resolves.toMatchObject({
      ok: false,
      message: expect.stringContaining("http://"),
    });
  });
});
