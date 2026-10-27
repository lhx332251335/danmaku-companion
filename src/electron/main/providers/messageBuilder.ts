import type { AppConfig, DanmakuInput, ScreenSnapshot } from "../../../shared/types";
import { defaultAppConfig } from "../../../shared/defaultConfig";

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
): ChatMessageContent {
  const content: Exclude<ChatMessageContent, string> = [];
  const trimmedText = userText.trim();

  if (trimmedText) {
    content.push({ type: "text", text: trimmedText });
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

export function templateValues(input: DanmakuInput, config: AppConfig): Record<string, string> {
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

export function buildMessages(
  input: DanmakuInput,
  config: AppConfig,
): { messages: ChatMessage[]; userText: string } {
  const prompt = config.prompt ?? defaultAppConfig.prompt;
  const values = templateValues(input, config);
  const system = renderTemplate(prompt.systemTemplate, values);
  const userText = renderTemplate(prompt.userTemplate, values);

  const messages: ChatMessage[] = [
    { role: "system", content: system },
  ];

  (input.history ?? []).forEach((round) => {
    messages.push({
      role: "user",
      content: userContent(round.userText, round.snapshot, config.model.visionEnabled),
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
