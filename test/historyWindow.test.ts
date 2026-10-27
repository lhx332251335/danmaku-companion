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

  it("batch-sliding drops the oldest half once the window is full", () => {
    const window = new HistoryWindow();
    const settings: HistoryWindowSettings = { historyRounds: 4, historyMode: "batch-sliding", historyIncludeImages: false };
    const sent = ["a", "b", "c", "d", "e", "f", "g", "h"].map((text) => cycle(window, settings, text));
    // Grows to 4, drops to 2 after the 5th round, grows again: the prefix only changes once per batch.
    expect(sent).toEqual([0, 1, 2, 3, 4, 2, 3, 4]);
    // The 8th round filled the window again, so it was just halved.
    expect(window.forRequest(4).map((round) => round.assistantText)).toEqual(
      ["g", "h"].map((text) => JSON.stringify({ comments: [text] })),
    );
  });

  it("drops screenshots by identity and keeps the text", () => {
    const window = new HistoryWindow();
    const settings: HistoryWindowSettings = { historyRounds: 5, historyMode: "reset-on-limit", historyIncludeImages: true };
    ["a", "b", "c"].forEach((text) => cycle(window, settings, text));
    const [first] = window.forRequest(5);
    expect(window.dropImages([first])).toBe(1);
    const after = window.forRequest(5);
    expect(after[0]).toMatchObject({ imageOmitted: true, snapshot: undefined, assistantText: first.assistantText });
    expect(window.imageCount).toBe(2);
    expect(window.dropAllImages()).toBe(2);
    expect(window.imageCount).toBe(0);
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

  it("shrinks after a rejected request: screenshots first, then the whole window", () => {
    const window = new HistoryWindow();
    const settings: HistoryWindowSettings = { historyRounds: 5, historyMode: "sliding", historyIncludeImages: true };
    ["a", "b"].forEach((text) => cycle(window, settings, text));
    expect(window.shrinkAfterRejection()).toBe("images");
    expect(window.imageCount).toBe(0);
    expect(window.length).toBe(2);
    expect(window.shrinkAfterRejection()).toBe("reset");
    expect(window.length).toBe(0);
    expect(window.shrinkAfterRejection()).toBeUndefined();
  });

  it("disables history when the round limit is 0", () => {
    const window = new HistoryWindow();
    const settings: HistoryWindowSettings = { historyRounds: 0, historyMode: "sliding", historyIncludeImages: true };
    expect(cycle(window, settings, "a")).toBe(0);
    expect(window.length).toBe(0);
  });
});
