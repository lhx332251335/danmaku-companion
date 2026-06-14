import type {
  AppConfig,
  ConnectionTestResult,
  DanmakuGenerationResult,
  DanmakuInput,
  DanmakuItem,
  ModelListResult,
  ModelOption,
  ScreenSnapshot,
} from "../../../shared/types";
import { defaultAppConfig } from "../../../shared/defaultConfig";
import type { ModelProvider } from "./modelProvider";

interface ChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string | Array<{ type?: string; text?: string }>;
    };
  }>;
  usage?: {
    input_tokens_details?: {
      cached_tokens?: number;
    };
    prompt_tokens_details?: {
      cached_tokens?: number;
    };
  };
}

type ChatMessageContent =
  | string
  | Array<
      | { type: "text"; text: string }
      | { type: "image_url"; image_url: { url: string } }
    >;

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: ChatMessageContent;
}

interface LmStudioNativeModel {
  key?: string;
  display_name?: string;
  type?: string;
  state?: string;
  capabilities?: {
    vision?: boolean;
  };
  loaded_instances?: Array<{
    id?: string;
  }>;
}

interface LmStudioLegacyModel {
  id?: string;
  type?: string;
  state?: string;
  capabilities?: string[];
}

const COMMENT_LENGTH_MIN = 10;
const COMMENT_LENGTH_MAX = 200;
const COMMENT_LENGTH_DEFAULT = 50;

function normalizeApiBase(baseUrl: string): string {
  let base = baseUrl.trim().replace(/\/+$/, "");
  base = base.replace(/\/chat\/completions$/i, "");
  base = base.replace(/\/models$/i, "");

  if (!/\/v\d+$/i.test(base)) {
    base = `${base}/v1`;
  }

  return base;
}

function endpoint(baseUrl: string, path: "chat/completions" | "models"): string {
  return `${normalizeApiBase(baseUrl)}/${path}`;
}

function serverRoot(baseUrl: string): string {
  const normalized = normalizeApiBase(baseUrl);
  try {
    const url = new URL(normalized);
    return url.origin;
  } catch {
    return normalized.replace(/\/v\d+$/i, "");
  }
}

function buildHeaders(apiKey: string, extra?: HeadersInit): HeadersInit {
  const trimmedKey = apiKey.trim();
  return {
    ...extra,
    ...(trimmedKey ? { Authorization: `Bearer ${trimmedKey}` } : {}),
  };
}

function textFromContent(content: ChatCompletionResponse["choices"]): string {
  const value = content?.[0]?.message?.content;
  if (typeof value === "string") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((part) => part.text ?? "").join("\n");
  }

  return "";
}

function arrayLiteralFromKey(raw: string, key: string): string | undefined {
  const keyPattern = new RegExp(`["']?${key}["']?\\s*:`, "i");
  const match = keyPattern.exec(raw);
  if (!match) {
    return undefined;
  }

  const start = raw.indexOf("[", match.index + match[0].length);
  if (start < 0) {
    return undefined;
  }

  let quote: string | undefined;
  let escaped = false;
  let depth = 0;

  for (let index = start; index < raw.length; index += 1) {
    const char = raw[index];

    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === quote) {
        quote = undefined;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }

    if (char === "[") {
      depth += 1;
    } else if (char === "]") {
      depth -= 1;
      if (depth === 0) {
        return raw.slice(start, index + 1);
      }
    }
  }

  return undefined;
}

function parseQuotedStringArray(raw: string): string[] {
  const items: string[] = [];
  let quote: string | undefined;
  let escaped = false;
  let current = "";

  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index];

    if (!quote) {
      if (char === '"' || char === "'") {
        quote = char;
        current = "";
      }
      continue;
    }

    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }

    if (char === "\\") {
      escaped = true;
      continue;
    }

    if (char === quote) {
      items.push(current.trim());
      quote = undefined;
      current = "";
      continue;
    }

    current += char;
  }

  return items.filter(Boolean);
}

function parseModelText(raw: string): string[] {
  const trimmed = raw.trim();
  const jsonCandidate =
    trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim() ?? trimmed;

  try {
    const parsed = JSON.parse(jsonCandidate) as unknown;
    if (Array.isArray(parsed)) {
      return parsed
        .map((item) => {
          if (typeof item === "string") return item;
          if (item && typeof item === "object" && "text" in item) {
            return String((item as { text: unknown }).text);
          }
          return "";
        })
        .filter(Boolean);
    }

    if (parsed && typeof parsed === "object" && "comments" in parsed) {
      const comments = (parsed as { comments: unknown }).comments;
      if (Array.isArray(comments)) {
        return comments.map(String).filter(Boolean);
      }
    }
  } catch {
    // Fall back to line parsing below.
  }

  const commentsArray = arrayLiteralFromKey(jsonCandidate, "comments");
  if (commentsArray) {
    const comments = parseQuotedStringArray(commentsArray);
    if (comments.length > 0) {
      return comments;
    }
  }

  return trimmed
    .split(/\r?\n/)
    .map((line) => line.replace(/^[-*\d.、\s]+/, "").trim())
    .filter(Boolean);
}

function normalizedMaxCommentLength(config: AppConfig): number {
  const value = config.danmaku.maxCommentLength ?? COMMENT_LENGTH_DEFAULT;
  if (!Number.isFinite(value)) {
    return COMMENT_LENGTH_DEFAULT;
  }

  return Math.round(Math.min(COMMENT_LENGTH_MAX, Math.max(COMMENT_LENGTH_MIN, value)));
}

function truncateText(text: string, maxLength: number): string {
  const chars = Array.from(text);
  if (chars.length <= maxLength) {
    return text;
  }

  if (maxLength <= 3) {
    return chars.slice(0, maxLength).join("");
  }

  return `${chars.slice(0, maxLength - 3).join("")}...`;
}

function historyComments(input: DanmakuInput): string[] {
  return (input.history ?? []).flatMap((round) => parseModelText(round.assistantText));
}

function sanitize(items: string[], config: AppConfig, maxItems: number, previousComments: string[]): DanmakuItem[] {
  const seen = new Set(previousComments.map((text) => text.toLowerCase()));
  const maxCommentLength = normalizedMaxCommentLength(config);
  return items
    .map((text) => text.replace(/\s+/g, " ").trim())
    .filter((text) => text.length > 0)
    .map((text) => truncateText(text, maxCommentLength))
    .filter((text) => {
      const key = text.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, maxItems)
    .map((text, index) => ({
      id: `${Date.now()}-${index}-${Math.random().toString(16).slice(2)}`,
      text,
      color: config.danmaku.palette[index % config.danmaku.palette.length],
      speedSeconds: config.danmaku.speedSeconds,
      createdAt: new Date().toISOString(),
      source: "model",
    }));
}

function renderTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (match, key: string) => {
    return values[key] ?? match;
  });
}

function userContent(userText: string, snapshot: ScreenSnapshot | undefined, visionEnabled: boolean): ChatMessageContent {
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

function buildMessages(input: DanmakuInput, config: AppConfig): { messages: ChatMessage[]; userText: string } {
  const user = config.user ?? defaultAppConfig.user;
  const prompt = config.prompt ?? defaultAppConfig.prompt;
  const values: Record<string, string> = {
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
    jsonShape: "{\"comments\":[\"comment 1\",\"comment 2\"]}",
  };

  const system = renderTemplate(
    prompt.systemTemplate,
    values,
  );
  const userText = renderTemplate(
    prompt.userTemplate,
    values,
  );

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

function cachedInputTokens(response: ChatCompletionResponse): number | undefined {
  return (
    response.usage?.input_tokens_details?.cached_tokens ??
    response.usage?.prompt_tokens_details?.cached_tokens
  );
}

function uniqueModels(models: ModelOption[]): ModelOption[] {
  const seen = new Set<string>();
  return models.filter((model) => {
    if (!model.id || seen.has(model.id)) {
      return false;
    }

    seen.add(model.id);
    return true;
  });
}

function mergeModelOptions(groups: ModelOption[][]): ModelOption[] {
  const merged = new Map<string, ModelOption>();

  groups.flat().forEach((model) => {
    if (!model.id) {
      return;
    }

    const current = merged.get(model.id);
    if (!current) {
      merged.set(model.id, model);
      return;
    }

    const nextState =
      current.state === "loaded" || !model.state
        ? current.state
        : model.state === "loaded" || !current.state
          ? model.state
          : current.state;

    merged.set(model.id, {
      id: model.id,
      name: current.name ?? model.name,
      state: nextState,
      type: current.type ?? model.type,
      vision: Boolean(current.vision || model.vision),
    });
  });

  return [...merged.values()];
}

function nativeModelOptions(data: { models?: LmStudioNativeModel[] }): ModelOption[] {
  return uniqueModels(
    (data.models ?? [])
      .map((model) => ({
        id: model.loaded_instances?.[0]?.id ?? model.key ?? "",
        name: model.display_name,
        state: model.loaded_instances?.length ? "loaded" : "not-loaded",
        type: model.type,
        vision: Boolean(model.capabilities?.vision),
      }))
      .filter((model) => model.id),
  );
}

function legacyModelOptions(data: { data?: LmStudioLegacyModel[] }): ModelOption[] {
  return uniqueModels(
    (data.data ?? [])
      .map((model) => ({
        id: model.id ?? "",
        state: model.state,
        type: model.type,
        vision: model.type === "vlm" || model.capabilities?.includes("vision"),
      }))
      .filter((model) => model.id),
  );
}

async function fetchJson<T>(url: string, config: AppConfig): Promise<T> {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(Math.min(config.model.timeoutMs, 12000)),
    headers: buildHeaders(config.model.apiKey),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`HTTP ${response.status}: ${body.slice(0, 240)}`);
  }

  return (await response.json()) as T;
}

export class OpenAICompatibleProvider implements ModelProvider {
  async generateDanmaku(input: DanmakuInput, config: AppConfig): Promise<DanmakuGenerationResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.model.timeoutMs);
    const externalAbort = () => controller.abort();

    if (input.abortSignal?.aborted) {
      externalAbort();
    } else {
      input.abortSignal?.addEventListener("abort", externalAbort, { once: true });
    }

    try {
      const requestEndpoint = endpoint(config.model.baseUrl, "chat/completions");
      const { messages, userText } = buildMessages(input, config);
      const requestBody: Record<string, unknown> = {
        model: config.model.model,
        messages,
        max_tokens: config.model.maxTokens,
        stream: false,
      };

      if (config.model.sendTemperature) {
        requestBody.temperature = config.model.temperature;
      }

      const response = await fetch(requestEndpoint, {
        method: "POST",
        signal: controller.signal,
        headers: buildHeaders(config.model.apiKey, {
          "Content-Type": "application/json",
        }),
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(
          `Model request failed at ${requestEndpoint} (${response.status}): ${body.slice(0, 240)}`,
        );
      }

      const data = (await response.json()) as ChatCompletionResponse;
      const text = textFromContent(data.choices);
      return {
        items: sanitize(parseModelText(text), config, input.maxItems, historyComments(input)),
        userText,
        assistantText: text,
        cachedInputTokens: cachedInputTokens(data),
      };
    } finally {
      clearTimeout(timeout);
      input.abortSignal?.removeEventListener("abort", externalAbort);
    }
  }
}

export async function testOpenAICompatibleConnection(
  config: AppConfig,
): Promise<ConnectionTestResult> {
  const requestEndpoint = endpoint(config.model.baseUrl, "models");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.min(config.model.timeoutMs, 12000));

  try {
    const response = await fetch(requestEndpoint, {
      signal: controller.signal,
      headers: buildHeaders(config.model.apiKey),
    });

    if (!response.ok) {
      const body = await response.text();
      return {
        ok: false,
        endpoint: requestEndpoint,
        message: `HTTP ${response.status}: ${body.slice(0, 240)}`,
      };
    }

    const data = (await response.json()) as { data?: Array<{ id?: string }> };
    const models = data.data?.map((item) => item.id).filter(Boolean) as string[] | undefined;
    return {
      ok: true,
      endpoint: requestEndpoint,
      message: models?.length ? `Connected. ${models.length} model(s) found.` : "Connected.",
      models,
    };
  } catch (error) {
    return {
      ok: false,
      endpoint: requestEndpoint,
      message: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function listOpenAICompatibleModels(config: AppConfig): Promise<ModelListResult> {
  const candidates = [
    {
      endpoint: `${serverRoot(config.model.baseUrl)}/api/v1/models`,
      parse: nativeModelOptions,
    },
    {
      endpoint: `${serverRoot(config.model.baseUrl)}/api/v0/models`,
      parse: legacyModelOptions,
    },
    {
      endpoint: endpoint(config.model.baseUrl, "models"),
      parse: legacyModelOptions,
    },
  ];
  const errors: string[] = [];
  const successfulEndpoints: string[] = [];
  const modelGroups: ModelOption[][] = [];

  for (const candidate of candidates) {
    try {
      const data = await fetchJson<unknown>(candidate.endpoint, config);
      const models = candidate.parse(data as never);
      if (models.length > 0) {
        successfulEndpoints.push(candidate.endpoint);
        modelGroups.push(models);
      } else {
        errors.push(`${candidate.endpoint}: empty`);
      }
    } catch (error) {
      errors.push(
        `${candidate.endpoint}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  const models = mergeModelOptions(modelGroups);
  if (models.length > 0) {
    return {
      ok: true,
      endpoint: successfulEndpoints.join(", "),
      message: `${models.length} model(s) found from ${successfulEndpoints.length} endpoint(s).`,
      models,
    };
  }

  return {
    ok: false,
    endpoint: candidates.map((candidate) => candidate.endpoint).join(", "),
    message: errors.join(" | "),
    models: [],
  };
}
