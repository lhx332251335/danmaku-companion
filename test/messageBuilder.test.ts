import { describe, expect, it } from "vitest";
import { buildMessages, renderTemplate, userContent } from "../src/electron/main/providers/messageBuilder";
import { makeConfig, makeSnapshot } from "./helpers";

const character = { name: "Mika", persona: "p", tone: "t", language: "zh-CN" };

describe("renderTemplate", () => {
  it("replaces known placeholders and keeps unknown ones", () => {
    expect(renderTemplate("{{ a }}-{{b}}-{{c}}", { a: "1", b: "2" })).toBe("1-2-{{c}}");
  });
});

describe("userContent", () => {
  it("includes the image only when vision is enabled", () => {
    const snapshot = makeSnapshot(100);
    expect(userContent("hi", snapshot, true)).toEqual([
      { type: "text", text: "hi" },
      { type: "image_url", image_url: { url: snapshot.dataUrl } },
    ]);
    expect(userContent("", snapshot, false)).toEqual([
      { type: "text", text: "Generate danmaku comments for the current context." },
    ]);
  });
});

describe("buildMessages", () => {
  it("emits system, history pairs, then the current user turn", () => {
    const config = makeConfig();
    const old = makeSnapshot(200);
    const current = makeSnapshot(300);
    const { messages, userText } = buildMessages(
      {
        character,
        maxItems: 3,
        snapshot: current,
        history: [{ userText: "", assistantText: '{"comments":["a"]}', snapshot: old }],
      },
      config,
    );
    expect(userText).toBe("");
    expect(messages.map((message) => message.role)).toEqual(["system", "user", "assistant", "user"]);
    expect(messages[0].content).toContain("You are Mika");
    expect(messages[0].content).toContain("Return exactly 3 comments");
    expect(JSON.stringify(messages[1].content)).toContain(old.dataUrl);
    expect(messages[2].content).toBe('{"comments":["a"]}');
    expect(JSON.stringify(messages[3].content)).toContain(current.dataUrl);
  });
});
