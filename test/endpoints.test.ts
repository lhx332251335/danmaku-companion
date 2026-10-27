import { describe, expect, it } from "vitest";
import { buildHeaders, endpoint, normalizeApiBase, serverRoot } from "../src/electron/main/providers/endpoints";

describe("endpoints", () => {
  it("normalizes common base URL shapes", () => {
    expect(normalizeApiBase("http://127.0.0.1:1234")).toBe("http://127.0.0.1:1234/v1");
    expect(normalizeApiBase("http://127.0.0.1:1234/v1/")).toBe("http://127.0.0.1:1234/v1");
    expect(normalizeApiBase("https://example.test/v1/chat/completions")).toBe("https://example.test/v1");
    expect(normalizeApiBase("https://example.test/v1/models")).toBe("https://example.test/v1");
    expect(normalizeApiBase(" https://example.test/api/v2 ")).toBe("https://example.test/api/v2");
  });

  it("builds endpoint URLs and the server root", () => {
    expect(endpoint("https://example.test/v1", "chat/completions")).toBe("https://example.test/v1/chat/completions");
    expect(endpoint("https://example.test", "models")).toBe("https://example.test/v1/models");
    expect(serverRoot("https://example.test:8443/v1")).toBe("https://example.test:8443");
  });

  it("adds a bearer token only when an API key is set", () => {
    expect(buildHeaders("  ")).toEqual({});
    expect(buildHeaders(" key ", { "Content-Type": "application/json" })).toEqual({
      "Content-Type": "application/json",
      Authorization: "Bearer key",
    });
  });
});
