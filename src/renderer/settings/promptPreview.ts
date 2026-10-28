import {
  CONTEXT_SUMMARY_HEADER,
  JSON_SHAPE,
  renderTemplate,
  templateValues,
} from "../../electron/main/providers/messageBuilder";
import type { AppConfig } from "../../shared/types";

/**
 * Prompt previews for the 角色与称呼 and 提示词模板 pages. The substitution itself is the main
 * process's own renderTemplate/templateValues (pure functions without Electron or Node
 * imports), so the preview cannot drift from what is sent.
 */

export { CONTEXT_SUMMARY_HEADER, JSON_SHAPE };

/** Same token pattern as renderTemplate. */
const TOKEN_PATTERN = /\{\{\s*([\w.-]+)\s*\}\}/g;

/**
 * Keys whose value is not a setting the user typed: the fixed JSON shape and the active-app
 * name, which is not implemented yet and is always "unknown".
 */
const FIXED_KEYS: ReadonlySet<string> = new Set(["jsonShape", "activeApp"]);

export type TemplateSegment =
  | { kind: "text"; text: string }
  /** A placeholder filled from the current settings. */
  | { kind: "value"; key: string; token: string; text: string }
  /** A placeholder with a fixed value (JSON shape, active app). */
  | { kind: "fixed"; key: string; token: string; text: string }
  /** A placeholder nothing fills: it is sent as typed. */
  | { kind: "unknown"; key: string; token: string; text: string };

/** The values the main process substitutes for one generation request. */
export function previewValues(config: AppConfig): Record<string, string> {
  return templateValues(
    { character: config.character, activeAppName: undefined, maxItems: config.runtime.itemsPerCycle },
    config,
  );
}

/** The values for the context summary request (adds {{summaryMaxChars}}). */
export function summaryPreviewValues(config: AppConfig): Record<string, string> {
  return {
    ...previewValues(config),
    summaryMaxChars: String(config.runtime.historySummaryMaxChars),
  };
}

/**
 * Splits a template into text and placeholder segments. Joining every segment's `text`
 * gives exactly renderTemplate(template, values).
 */
export function templateSegments(template: string, values: Record<string, string>): TemplateSegment[] {
  const segments: TemplateSegment[] = [];
  let last = 0;

  for (const match of template.matchAll(TOKEN_PATTERN)) {
    const index = match.index ?? 0;
    const token = match[0];
    const key = match[1];
    if (index > last) {
      segments.push({ kind: "text", text: template.slice(last, index) });
    }
    // renderTemplate on the token alone decides the substitution, so the rules stay the main
    // process's (an unknown key is left as typed).
    const text = renderTemplate(token, values);
    const known = Object.prototype.hasOwnProperty.call(values, key);
    const kind = !known && text === token ? "unknown" : FIXED_KEYS.has(key) ? "fixed" : "value";
    segments.push({ kind, key, token, text });
    last = index + token.length;
  }

  if (last < template.length) {
    segments.push({ kind: "text", text: template.slice(last) });
  }

  return segments;
}

/** The system template mentions {{requestedCount}}; otherwise saving appends a line asking for it. */
export function mentionsRequestedCount(systemTemplate: string): boolean {
  // Mirrors normalizeConfig in the main process, which checks for the bare word.
  return systemTemplate.includes("requestedCount");
}

/**
 * Why the context summary is not requested even though it is on: the summarizer only runs one
 * round before reset-on-limit starts over or batch-sliding halves the window.
 */
export function summaryInactiveReason(runtime: AppConfig["runtime"]): string | undefined {
  if (!runtime.historySummaryEnabled) {
    return undefined;
  }
  if (runtime.historyRounds <= 0) {
    return "历史轮数为 0，没有可以摘要的历史";
  }
  if (runtime.historyMode === "sliding") {
    return "「逐轮滑动」模式不会整体清空历史，不会请求摘要";
  }
  return undefined;
}
