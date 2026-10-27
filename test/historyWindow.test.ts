import { describe, expect, it } from "vitest";
import { HistoryWindow, type HistoryWindowSettings } from "../src/electron/main/runtime/historyWindow";
import { makeSnapshot } from "./helpers";

function result(text: string, items = 1) {
  return {
    items: Array.from({ length: items }, (_, index) => ({ id: `${text}-${index}`, text, createdAt: "" })),
    userText: "",
    assistantText: items > 0 ? JSON.stringify({ comments: [text] }) : "",
  };
}

function cycle(window: HistoryWindow, settings: HistoryWindowSettings, text: string, items = 1): number {
  const request = window.forRequest(settings.historyRounds);
  window.remember(result(text, items), makeSnapshot(100), settings, request.length);
  return request.length;
}

describe("HistoryWindow", () => {
  it("reset-on-limit grows to the limit and then starts over", () => {
    const window = new HistoryWindow();
    const settings: HistoryWindowSettings = { historyRounds: 3, historyMode: "reset-on-limit", historyIncludeImages: false };
    const sent = ["a", "b", "c", "d", "e", "f"].map((text) => cycle(window, settings, text));
    expect(sent).toEqual([0, 1, 2, 3, 0, 1]);
  });

  it("sliding keeps the most recent rounds", () => {
    const window = new HistoryWindow();
    const settings: HistoryWindowSettings = { historyRounds: 2, historyMode: "sliding", historyIncludeImages: false };
    ["a", "b", "c"].forEach((text) => cycle(window, settings, text));
    expect(window.forRequest(2).map((round) => round.assistantText)).toEqual([
      JSON.stringify({ comments: ["b"] }),
      JSON.stringify({ comments: ["c"] }),
    ]);
  });

  it("keeps snapshots only when history images are enabled", () => {
    const withImages = new HistoryWindow();
    cycle(withImages, { historyRounds: 3, historyMode: "sliding", historyIncludeImages: true }, "a");
    expect(withImages.forRequest(3)[0].snapshot).toBeDefined();

    const withoutImages = new HistoryWindow();
    cycle(withoutImages, { historyRounds: 3, historyMode: "sliding", historyIncludeImages: false }, "a");
    expect(withoutImages.forRequest(3)[0].snapshot).toBeUndefined();
  });

  it("counts empty generations toward the window without storing them", () => {
    const window = new HistoryWindow();
    const settings: HistoryWindowSettings = { historyRounds: 2, historyMode: "reset-on-limit", historyIncludeImages: false };
    expect(cycle(window, settings, "a")).toBe(0);
    expect(cycle(window, settings, "empty", 0)).toBe(1);
    expect(window.length).toBe(0);
    expect(cycle(window, settings, "b")).toBe(0);
  });

  it("disables history when the round limit is 0", () => {
    const window = new HistoryWindow();
    const settings: HistoryWindowSettings = { historyRounds: 0, historyMode: "sliding", historyIncludeImages: true };
    expect(cycle(window, settings, "a")).toBe(0);
    expect(window.length).toBe(0);
  });
});
