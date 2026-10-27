import { describe, expect, it } from "vitest";
import {
  buildHeaders,
  endpoint,
  lmStudioModelEndpoints,
  normalizeApiBase,
} from "../src/electron/main/providers/endpoints";

describe("normalizeApiBase", () => {
  it.each([
    ["bare host gets /v1", "http://127.0.0.1:1234", "http://127.0.0.1:1234/v1"],
    ["bare host with slash", "http://127.0.0.1:1234/", "http://127.0.0.1:1234/v1"],
    ["trailing slashes", "http://127.0.0.1:1234/v1//", "http://127.0.0.1:1234/v1"],
    ["surrounding spaces", " https://example.test/api/v2 ", "https://example.test/api/v2"],
    ["pasted chat endpoint", "https://example.test/v1/chat/completions", "https://example.test/v1"],
    ["pasted completions endpoint", "https://example.test/v1/completions", "https://example.test/v1"],
    ["pasted models endpoint", "https://example.test/v1/models/", "https://example.test/v1"],
    ["query string is kept", "https://example.test/v1/chat/completions?api-version=2", "https://example.test/v1?api-version=2"],
    ["hash is dropped", "https://example.test/v1#top", "https://example.test/v1"],
    ["non-/vN prefix is kept", "https://generativelanguage.example/v1beta/openai", "https://generativelanguage.example/v1beta/openai"],
    ["gateway path after /v1", "https://gateway.example/v1/acc/gw/openai", "https://gateway.example/v1/acc/gw/openai"],
    ["reverse proxy prefix", "https://proxy.example/llm/v1/", "https://proxy.example/llm/v1"],
    ["prefix without version", "https://proxy.example/openai/chat/completions", "https://proxy.example/openai"],
  ])("%s", (_name, input, expected) => {
    expect(normalizeApiBase(input)).toBe(expected);
  });

  it.each([
    ["", /未填写/],
    ["   ", /未填写/],
    ["127.0.0.1:1234/v1", /http:\/\/ 或 https:\/\//],
    ["localhost:1234", /http:\/\/ 或 https:\/\//],
    ["ftp://example.test/v1", /http:\/\/ 或 https:\/\//],
  ])("rejects %j with a readable message", (input, message) => {
    expect(() => normalizeApiBase(input)).toThrow(message);
  });
});

describe("endpoint", () => {
  it.each([
    ["https://example.test/v1", "chat/completions", "https://example.test/v1/chat/completions"],
    ["https://example.test", "models", "https://example.test/v1/models"],
    ["https://example.test/v1/chat/completions?x=1", "models", "https://example.test/v1/models?x=1"],
    ["https://generativelanguage.example/v1beta/openai/", "chat/completions", "https://generativelanguage.example/v1beta/openai/chat/completions"],
  ] as const)("%s + %s", (base, path, expected) => {
    expect(endpoint(base, path)).toBe(expected);
  });
});

describe("lmStudioModelEndpoints", () => {
  it.each([
    ["http://127.0.0.1:1234", { native: "http://127.0.0.1:1234/api/v1/models", legacy: "http://127.0.0.1:1234/api/v0/models" }],
    ["https://example.test:8443/v1", { native: "https://example.test:8443/api/v1/models", legacy: "https://example.test:8443/api/v0/models" }],
    ["https://proxy.example/lmstudio/v1", { native: "https://proxy.example/lmstudio/api/v1/models", legacy: "https://proxy.example/lmstudio/api/v0/models" }],
    ["https://generativelanguage.example/v1beta/openai", undefined],
    ["https://example.test/api/v2", undefined],
  ])("%s", (base, expected) => {
    expect(lmStudioModelEndpoints(base)).toEqual(expected);
  });
});

describe("buildHeaders", () => {
  it("adds a bearer token only when an API key is set", () => {
    expect(buildHeaders("  ")).toEqual({});
    expect(buildHeaders(" key ", { "Content-Type": "application/json" })).toEqual({
      "Content-Type": "application/json",
      Authorization: "Bearer key",
    });
  });
});
