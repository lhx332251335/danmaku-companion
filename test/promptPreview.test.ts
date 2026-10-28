import { describe, expect, it } from "vitest";
import { renderPrompts, renderTemplate } from "../src/electron/main/providers/messageBuilder";
import { defaultAppConfig } from "../src/shared/defaultConfig";
import type { AppConfig } from "../src/shared/types";
import {
  JSON_SHAPE,
  mentionsRequestedCount,
  previewValues,
  summaryInactiveReason,
  summaryPreviewValues,
  templateSegments,
} from "../src/renderer/settings/promptPreview";

function config(patch: Partial<AppConfig> = {}): AppConfig {
  return { ...structuredClone(defaultAppConfig), ...patch };
}

function joined(template: string, values: Record<string, string>): string {
  return templateSegments(template, values)
    .map((segment) => segment.text)
    .join("");
}

describe("prompt preview", () => {
  it("renders the system template exactly like the request builder", () => {
    const current = config({
      character: { name: "Mika", persona: "温柔的陪看搭子", tone: "简短", language: "ja" },
      user: { name: "阿亮", role: "正在打游戏的玩家" },
    });
    current.runtime.itemsPerCycle = 5;
    const values = previewValues(current);
    const sent = renderPrompts(
      { character: current.character, activeAppName: undefined, maxItems: 5 },
      current,
    ).systemText;

    expect(joined(current.prompt.systemTemplate, values)).toBe(sent);
    expect(sent).toContain("You are Mika,");
    expect(sent).toContain("Return exactly 5 comments");
  });

  it("marks settings values, fixed values and unknown placeholders", () => {
    const values = previewValues(config());
    const segments = templateSegments(
      "A {{companion.name}} B {{ user.role }} C {{jsonShape}} D {{activeApp}} E {{nope}}",
      values,
    );
    const tokens = segments.filter((segment) => segment.kind !== "text");

    expect(tokens.map((segment) => [segment.kind, segment.key])).toEqual([
      ["value", "companion.name"],
      ["value", "user.role"],
      ["fixed", "jsonShape"],
      ["fixed", "activeApp"],
      ["unknown", "nope"],
    ]);
    expect(tokens[1].text).toBe("屏幕前的用户");
    expect(tokens[2].text).toBe(JSON_SHAPE);
    expect(tokens[3].text).toBe("unknown");
    // Unknown placeholders are sent as typed, like renderTemplate does.
    expect(tokens[4].text).toBe("{{nope}}");
  });

  it("keeps text around and between tokens", () => {
    const values = previewValues(config());
    const template = "{{user.name}}{{user.name}}\n末尾";
    expect(joined(template, values)).toBe(renderTemplate(template, values));
    expect(templateSegments("", values)).toEqual([]);
    expect(templateSegments("没有占位符", values)).toEqual([{ kind: "text", text: "没有占位符" }]);
  });

  it("treats an empty setting as a value, not as a missing placeholder", () => {
    const current = config();
    current.character.name = "";
    const [segment] = templateSegments("{{companion.name}}", previewValues(current));
    expect(segment).toMatchObject({ kind: "value", text: "" });
  });

  it("adds summaryMaxChars only for the summary request", () => {
    const current = config();
    current.runtime.historySummaryMaxChars = 600;
    expect(previewValues(current)).not.toHaveProperty("summaryMaxChars");
    expect(joined("不超过 {{summaryMaxChars}} 字", summaryPreviewValues(current))).toBe("不超过 600 字");
  });

  it("knows when saving will append the requestedCount line", () => {
    expect(mentionsRequestedCount(defaultAppConfig.prompt.systemTemplate)).toBe(true);
    expect(mentionsRequestedCount("You are {{companion.name}}.")).toBe(false);
  });

  it("says when the context summary is on but never requested", () => {
    const runtime = { ...defaultAppConfig.runtime, historySummaryEnabled: true, historyRounds: 8 };
    expect(summaryInactiveReason({ ...runtime, historySummaryEnabled: false })).toBeUndefined();
    expect(summaryInactiveReason({ ...runtime, historyMode: "reset-on-limit" })).toBeUndefined();
    expect(summaryInactiveReason({ ...runtime, historyMode: "batch-sliding" })).toBeUndefined();
    expect(summaryInactiveReason({ ...runtime, historyMode: "sliding" })).toContain("逐轮滑动");
    expect(summaryInactiveReason({ ...runtime, historyRounds: 0 })).toContain("历史轮数为 0");
  });
});
