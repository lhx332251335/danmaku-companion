import { describe, expect, it } from "vitest";
import { isAppUrl } from "../src/electron/main/windowPolicy";

describe("isAppUrl", () => {
  const fileEntry = "file:///C:/Program%20Files/Danmaku%20Companion/resources/app/dist/renderer/index.html";

  it("allows the packaged renderer page with any query or hash", () => {
    expect(isAppUrl(`${fileEntry}?view=settings`, fileEntry)).toBe(true);
    expect(isAppUrl(`${fileEntry}?view=overlay#top`, fileEntry)).toBe(true);
  });

  it("blocks other local files, such as a dropped .html file", () => {
    expect(isAppUrl("file:///C:/Users/me/Downloads/page.html", fileEntry)).toBe(false);
    expect(isAppUrl("file:///C:/Program%20Files/Danmaku%20Companion/resources/app/dist/renderer/other.html", fileEntry)).toBe(false);
    expect(isAppUrl("file://evil-host/C:/Program%20Files/Danmaku%20Companion/resources/app/dist/renderer/index.html", fileEntry)).toBe(false);
  });

  it("blocks remote pages and script URLs", () => {
    expect(isAppUrl("https://example.com/", fileEntry)).toBe(false);
    expect(isAppUrl("javascript:alert(1)", fileEntry)).toBe(false);
    expect(isAppUrl("not a url", fileEntry)).toBe(false);
  });

  it("allows only the dev server origin in development", () => {
    const devEntry = "http://127.0.0.1:5173";
    expect(isAppUrl("http://127.0.0.1:5173/?view=settings", devEntry)).toBe(true);
    expect(isAppUrl("http://127.0.0.1:5174/?view=settings", devEntry)).toBe(false);
    expect(isAppUrl("http://localhost:5173/", devEntry)).toBe(false);
    expect(isAppUrl("https://127.0.0.1:5173/", devEntry)).toBe(false);
    expect(isAppUrl(`${fileEntry}?view=settings`, devEntry)).toBe(false);
  });
});
