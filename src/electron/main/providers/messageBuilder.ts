import type { AppConfig, DanmakuInput, ScreenSnapshot } from "../../../shared/types";
import { defaultAppConfig } from "../../../shared/defaultConfig";
import { normalizedMaxTokens } from "./modelSettings";

export type ChatMessageContent =
  | string
  | Array<
      | { type: "text"; text: string }
      | { type: "image_url"; image_url: { url: string } }
    >;

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: ChatMessageContent;
}

/** Text that replaces a history screenshot dropped to keep requests under the size budget. */
export const OMITTED_SCREENSHOT_NOTE = "[Earlier screenshot omitted to keep the request small]";

export const JSON_SHAPE = "{\"comments\":[\"comment 1\",\"comment 2\"]}";

export function renderTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (match, key: string) => {
    return values[key] ?? match;
  });
}

export function userContent(
  userText: string,
  snapshot: ScreenSnapshot | undefined,
  visionEnabled: boolean,
  imageOmitted = false,
): ChatMessageContent {
  const content: Exclude<ChatMessageContent, string> = [];
  const trimmedText = userText.trim();

  if (trimmedText) {
    content.push({ type: "text", text: trimmedText });
  }

  if (imageOmitted) {
    content.push({ type: "text", text: OMITTED_SCREENSHOT_NOTE });
  }

  if (visionEnabled && snapshot) {
    content.push({
      type: "image_url",
      image_url: { url: snapshot.dataUrl },
    });
  }

  if (content.length === 0) {
    content.push({ type: "text", text: "Generate danmaku comments for the current context." });
  }

  return content;
}

export function templateValues(
  input: Pick<DanmakuInput, "character" | "activeAppName" | "maxItems">,
  config: AppConfig,
): Record<string, string> {
  const user = config.user ?? defaultAppConfig.user;
  return {
    "companion.name": input.character.name,
    "companion.persona": input.character.persona,
    "companion.tone": input.character.tone,
    "companion.language": input.character.language,
    "character.name": input.character.name,
    "character.persona": input.character.persona,
    "character.tone": input.character.tone,
    "character.language": input.character.language,
    "user.name": user.name,
    "user.role": user.role,
    activeApp: input.activeAppName ?? "unknown",
    requestedCount: String(input.maxItems),
    jsonShape: JSON_SHAPE,
  };
}

export function renderPrompts(
  input: Pick<DanmakuInput, "character" | "activeAppName" | "maxItems">,
  config: AppConfig,
): { systemText: string; userText: string } {
  const prompt = config.prompt ?? defaultAppConfig.prompt;
  const values = templateValues(input, config);
  return {
    systemText: renderTemplate(prompt.systemTemplate, values),
    userText: renderTemplate(prompt.userTemplate, values),
  };
}

export function buildMessages(
  input: DanmakuInput,
  config: AppConfig,
): { messages: ChatMessage[]; userText: string } {
  const { systemText: system, userText } = renderPrompts(input, config);

  const messages: ChatMessage[] = [
    { role: "system", content: system },
  ];

  (input.history ?? []).forEach((round) => {
    messages.push({
      role: "user",
      content: userContent(
        round.userText,
        round.snapshot,
        config.model.visionEnabled,
        round.imageOmitted,
      ),
    });
    messages.push({
      role: "assistant",
      content: round.assistantText,
    });
  });

  messages.push({
    role: "user",
    content: userContent(userText, input.snapshot, config.model.visionEnabled),
  });

  return { messages, userText };
}

export function buildRequestBody(
  input: DanmakuInput,
  config: AppConfig,
): { body: Record<string, unknown>; userText: string } {
  const { messages, userText } = buildMessages(input, config);
  const body: Record<string, unknown> = {
    model: config.model.model,
    messages,
    max_tokens: normalizedMaxTokens(config),
    stream: false,
  };

  if (config.model.sendTemperature) {
    body.temperature = config.model.temperature;
  }

  return { body, userText };
}
