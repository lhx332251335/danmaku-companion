import { describe, expect, it, vi } from "vitest";
import { RequestTooLargeError } from "../src/electron/main/providers/errors";
import { OpenAICompatibleProvider } from "../src/electron/main/providers/openAiCompatibleProvider";
import { httpStatusOf, isRepeatingRequestError } from "../src/electron/main/runtime/failurePolicy";
import { makeConfig } from "./helpers";

function providerError(status: number, body = ""): Error {
  return new Error(`Model request failed at http://llm.test/v1/chat/completions (${status}): ${body}`);
}

describe("failure policy", () => {
  it("reads the status from the provider message, a status field or a size error", () => {
    expect(httpStatusOf(providerError(400, "the request exceeds the available context size"))).toBe(400);
    expect(httpStatusOf(new Error("HTTP 422: bad request"))).toBe(422);
    expect(httpStatusOf(Object.assign(new Error("failed"), { status: 429 }))).toBe(429);
    expect(httpStatusOf(new RequestTooLargeError({ message: "too big", requestBytes: 1, fromServer: false }))).toBe(413);
    expect(httpStatusOf(new Error("This operation was aborted"))).toBeUndefined();
  });

  it("treats context and size rejections as repeating, and transient errors as not", () => {
    expect(isRepeatingRequestError(providerError(400))).toBe(true);
    expect(isRepeatingRequestError(providerError(422))).toBe(true);
    expect(
      isRepeatingRequestError(new RequestTooLargeError({ message: "413", requestBytes: 1, fromServer: true })),
    ).toBe(true);
    expect(isRepeatingRequestError(providerError(429))).toBe(false);
    expect(isRepeatingRequestError(providerError(502, "Bad gateway"))).toBe(false);
    expect(isRepeatingRequestError(providerError(401))).toBe(false);
    expect(isRepeatingRequestError(new Error("fetch failed"))).toBe(false);
    expect(isRepeatingRequestError("timeout")).toBe(false);
  });
});

describe("provider errors", () => {
  it("classifies the provider's HTTP failures by status, not by message text", async () => {
    const config = makeConfig({ model: { baseUrl: "http://llm.test/v1" } });
    const failWith = async (status: number, body: string) => {
      vi.stubGlobal("fetch", vi.fn(async () => new Response(body, { status })));
      try {
        return await new OpenAICompatibleProvider()
          .generateDanmaku({ character: config.character, maxItems: 3 }, config)
          .catch((error: unknown) => error);
      } finally {
        vi.unstubAllGlobals();
      }
    };
    const contextOverflow = await failWith(400, '{"error":{"type":"exceed_context_size_error","n_prompt_tokens":300000,"n_ctx":262144}}');
    expect((contextOverflow as { status?: number }).status).toBe(400);
    expect(isRepeatingRequestError(contextOverflow)).toBe(true);
    expect(isRepeatingRequestError(await failWith(502, "upstream request failed"))).toBe(false);
    expect(isRepeatingRequestError(await failWith(429, "slow down"))).toBe(false);
  });
});
