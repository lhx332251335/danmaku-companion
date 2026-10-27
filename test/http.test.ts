import { afterEach, describe, expect, it, vi } from "vitest";
import { describeFetchError, summarizeErrorBody } from "../src/electron/main/providers/errors";
import { fetchJson, fetchText, parseJsonBody } from "../src/electron/main/providers/http";

const url = "http://llm.test/v1/chat/completions";

const cloudflare502 = `<!DOCTYPE html>
<html lang="en-US">
<head>
<title>llm.test | 502: Bad gateway</title>
<style>body { color: red }</style>
</head>
<body><div id="cf-error-details"><h1>Bad gateway</h1><span>Error code 502</span></div></body>
</html>`;

afterEach(() => {
  vi.unstubAllGlobals();
});

function hangingFetch() {
  return vi.fn(
    (_url: string, init: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
      }),
  );
}

describe("summarizeErrorBody", () => {
  it.each([
    ["an OpenAI error object", '{"error":{"message":"model not loaded","type":"server_error"}}', "model not loaded"],
    ["a string error", '{"error":"overloaded"}', "overloaded"],
    ["a top-level message", '{"message":"Unauthorized"}', "Unauthorized"],
    ["a FastAPI detail", '{"detail":"Not Found"}', "Not Found"],
    ["an error code only", '{"error":{"code":"rate_limited"}}', "rate_limited"],
    ["a Cloudflare HTML page", cloudflare502, "llm.test | 502: Bad gateway"],
    ["HTML without a title", "<html><body><h1>Bad &amp; gateway</h1><script>x()</script></body></html>", "Bad & gateway"],
    ["plain text", "  upstream\n  timed out ", "upstream timed out"],
    ["an empty body", "", ""],
  ])("%s", (_name, body, expected) => {
    expect(summarizeErrorBody(body)).toBe(expected);
  });

  it("clips long bodies", () => {
    const summary = summarizeErrorBody("x".repeat(1000));
    expect(summary).toHaveLength(240);
    expect(summary.endsWith("…")).toBe(true);
  });
});

describe("describeFetchError", () => {
  it("names the endpoint and the network cause", () => {
    const refused = new TypeError("fetch failed", {
      cause: Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:1234"), { code: "ECONNREFUSED" }),
    });
    expect(describeFetchError(refused, url, 45_000, false)).toBe(
      `无法连接模型服务：fetch failed：connect ECONNREFUSED 127.0.0.1:1234（${url}）`,
    );

    const tls = new TypeError("fetch failed", {
      cause: Object.assign(new Error("unable to verify the first certificate"), { code: "UNABLE_TO_VERIFY_LEAF_SIGNATURE" }),
    });
    expect(describeFetchError(tls, url, 45_000, false)).toContain(
      "UNABLE_TO_VERIFY_LEAF_SIGNATURE unable to verify the first certificate",
    );

    const multi = new TypeError("fetch failed", {
      cause: new AggregateError([new Error("connect ECONNREFUSED ::1:1234")], ""),
    });
    expect(describeFetchError(multi, url, 45_000, false)).toContain("connect ECONNREFUSED ::1:1234");
  });

  it("reports timeouts with the configured seconds", () => {
    const timeout = new DOMException("The operation was aborted due to timeout", "TimeoutError");
    expect(describeFetchError(timeout, url, 45_000, false)).toMatch(/^请求超时：45 秒内没有收到响应（http:\/\/llm\.test/);
    expect(describeFetchError(new Error("This operation was aborted"), url, 1500, true)).toContain("1.5 秒");
  });
});

describe("fetchText", () => {
  it("turns a timeout during the request into a readable error", async () => {
    vi.stubGlobal("fetch", hangingFetch());
    await expect(fetchText(url, {}, 30)).rejects.toThrow(/请求超时.*llm\.test/);
  });

  it("rethrows a caller abort unchanged", async () => {
    vi.stubGlobal("fetch", hangingFetch());
    const controller = new AbortController();
    const request = fetchText(url, {}, 60_000, controller.signal);
    controller.abort();
    await expect(request).rejects.toMatchObject({ name: "AbortError" });
  });

  it("returns status and body", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("hi", { status: 201 })));
    await expect(fetchText(url, {}, 1000)).resolves.toMatchObject({ ok: true, status: 201, body: "hi" });
  });
});

describe("fetchJson", () => {
  it("summarizes an HTML error page to its title", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(cloudflare502, { status: 502 })));
    const error = (await fetchJson(url, {}, 1000).catch((caught: unknown) => caught)) as Error;
    expect(error.message).toBe(`HTTP 502：llm.test | 502: Bad gateway（${url}）`);
  });

  it("falls back to the status text for an empty error body", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 503, statusText: "Service Unavailable" })));
    await expect(fetchJson(url, {}, 1000)).rejects.toThrow(`HTTP 503：Service Unavailable（${url}）`);
  });

  it("rejects a 200 response that is not JSON", () => {
    expect(() => parseJsonBody({ ok: true, status: 200, statusText: "OK", body: cloudflare502 }, url)).toThrow(
      `响应不是 JSON：llm.test | 502: Bad gateway（${url}）`,
    );
  });
});
