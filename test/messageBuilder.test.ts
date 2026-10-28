import { describe, expect, it } from "vitest";
import {
  CONTEXT_SUMMARY_HEADER,
  buildMessages,
  buildSummaryRequestBody,
  renderTemplate,
  summaryMaxTokens,
  userContent,
} from "../src/electron/main/providers/messageBuilder";
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

describe("context summary", () => {
  const history = [{ userText: "", assistantText: '{"comments":["a"]}', snapshot: makeSnapshot(200) }];

  it("appends the summary to the system prompt", () => {
    const config = makeConfig();
    const plain = buildMessages({ character, maxItems: 3 }, config).messages[0].content as string;
    const { messages } = buildMessages({ character, maxItems: 3, contextSummary: " 用户在写代码 " }, config);
    expect(messages[0].content).toBe(`${plain}\n\n${CONTEXT_SUMMARY_HEADER}\n用户在写代码`);
  });

  it("shares the generation request's prefix and ends with the summary instruction", () => {
    const config = makeConfig({ model: { sendTemperature: false } });
    const input = { character, maxItems: 3, history, contextSummary: "之前的摘要" };
    const generation = buildMessages({ ...input, snapshot: makeSnapshot(300) }, config).messages;
    const body = buildSummaryRequestBody(input, config, 300);
    const messages = body.messages as typeof generation;

    expect(messages.slice(0, -1)).toEqual(generation.slice(0, -1));
    const instruction = JSON.stringify(messages.at(-1)?.content);
    expect(messages.at(-1)?.role).toBe("user");
    expect(instruction).toContain("300");
    expect(instruction).not.toContain("{{");
    expect(instruction).not.toContain("image_url");
    expect(body.max_tokens).toBe(summaryMaxTokens(300));
    expect(body).not.toHaveProperty("temperature");
  });

  it("uses a custom summary template", () => {
    const config = makeConfig({ prompt: { summaryTemplate: "总结给 {{user.name}}，{{summaryMaxChars}} 字内" } });
    const body = buildSummaryRequestBody({ character, maxItems: 3 }, config, 150);
    const last = (body.messages as Array<{ content: unknown }>).at(-1);
    expect(JSON.stringify(last?.content)).toContain("150 字内");
  });

  it("budgets output tokens for the summary length", () => {
    expect(summaryMaxTokens(100)).toBe(556);
    expect(summaryMaxTokens(2000)).toBe(4096);
  });
});
