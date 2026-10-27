import type { AppConfig, DanmakuHistoryRound, DanmakuItem } from "../../../shared/types";
import { LIMITS, clampToRange } from "../../../shared/limits";

export interface ChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string | Array<{ type?: string; text?: string }>;
    };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    input_tokens?: number;
    output_tokens?: number;
    input_tokens_details?: {
      cached_tokens?: number;
    };
    prompt_tokens_details?: {
      cached_tokens?: number;
    };
    /** DeepSeek */
    prompt_cache_hit_tokens?: number;
    /** Anthropic-style gateways */
    cache_read_input_tokens?: number;
  };
  /** llama.cpp server: cache_n tokens were reused, prompt_n tokens were newly processed. */
  timings?: {
    cache_n?: number;
    prompt_n?: number;
    prompt_ms?: number;
  };
}

export interface UsageSummary {
  promptTokens?: number;
  completionTokens?: number;
  cachedTokens?: number;
  /** Time the server spent processing the uncached part of the prompt (llama.cpp timings). */
  promptMs?: number;
}

const COMMENT_LENGTH_DEFAULT = 50;

export function textFromContent(content: ChatCompletionResponse["choices"]): string {
  const value = content?.[0]?.message?.content;
  if (typeof value === "string") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((part) => part.text ?? "").join("\n");
  }

  return "";
}

export function arrayLiteralFromKey(raw: string, key: string): string | undefined {
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

  return raw.slice(start);
}

export function parseQuotedStringArray(raw: string): string[] {
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

export function parseModelText(raw: string): string[] {
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

export function normalizedMaxCommentLength(config: AppConfig): number {
  const value = config.danmaku.maxCommentLength ?? COMMENT_LENGTH_DEFAULT;
  if (!Number.isFinite(value)) {
    return COMMENT_LENGTH_DEFAULT;
  }

  return Math.round(clampToRange(value, LIMITS.maxCommentLength));
}

export function truncateText(text: string, maxLength: number): string {
  const chars = Array.from(text);
  if (chars.length <= maxLength) {
    return text;
  }

  if (maxLength <= 3) {
    return chars.slice(0, maxLength).join("");
  }

  return `${chars.slice(0, maxLength - 3).join("")}...`;
}

export function historyComments(history: DanmakuHistoryRound[] | undefined): string[] {
  return (history ?? []).flatMap((round) => parseModelText(round.assistantText));
}

export function sanitize(
  items: string[],
  config: AppConfig,
  maxItems: number,
  previousComments: string[],
): DanmakuItem[] {
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

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function extractUsage(response: ChatCompletionResponse): UsageSummary {
  const usage = response.usage;
  const timings = response.timings;
  const cacheN = finiteNumber(timings?.cache_n);
  const promptN = finiteNumber(timings?.prompt_n);
  const cachedTokens =
    finiteNumber(usage?.prompt_tokens_details?.cached_tokens) ??
    finiteNumber(usage?.input_tokens_details?.cached_tokens) ??
    finiteNumber(usage?.prompt_cache_hit_tokens) ??
    finiteNumber(usage?.cache_read_input_tokens) ??
    cacheN;
  const promptTokens =
    finiteNumber(usage?.prompt_tokens) ??
    finiteNumber(usage?.input_tokens) ??
    (cacheN !== undefined && promptN !== undefined ? cacheN + promptN : undefined);

  return {
    promptTokens,
    completionTokens:
      finiteNumber(usage?.completion_tokens) ?? finiteNumber(usage?.output_tokens),
    cachedTokens,
    promptMs: finiteNumber(timings?.prompt_ms),
  };
}

export function cachedInputTokens(response: ChatCompletionResponse): number | undefined {
  return extractUsage(response).cachedTokens;
}
