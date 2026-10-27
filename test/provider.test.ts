import { afterEach, describe, expect, it, vi } from "vitest";
import { RequestTooLargeError } from "../src/electron/main/providers/errors";
import { OpenAICompatibleProvider } from "../src/electron/main/providers/openAiCompatibleProvider";
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
});
