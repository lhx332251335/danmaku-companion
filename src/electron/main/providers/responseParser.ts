import type { AppConfig, DanmakuHistoryRound, DanmakuItem } from "../../../shared/types";
import { LIMITS, clampToRange } from "../../../shared/limits";
import { errorText } from "./errors";

export interface ChatCompletionResponse {
  choices?: Array<{
    finish_reason?: string | null;
    message?: {
      content?: string | Array<{ type?: string; text?: string }> | null;
      /** Separate reasoning channel (llama.cpp, DeepSeek, vLLM); the content stays clean. */
      reasoning_content?: string | null;
      reasoning?: string | null;
    };
  }>;
  /** Some gateways report failures inside an HTTP 200 body. */
  error?: unknown;
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

const REASONING_BLOCK = /<(think|thinking)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;
const REASONING_CLOSE = /<\/(?:think|thinking)\s*>/gi;
const REASONING_OPEN = /<(?:think|thinking)\b[^>]*>/i;
const CODE_FENCE = /```[\w-]*\s*([\s\S]*?)(?:```|$)/;
/** A `{` or `[` that opens JSON, as opposed to a bracketed emoticon such as "[doge]". */
const JSON_START = /^(?:\{\s*(?:["'}]|$)|\[\s*(?:["'[{\]]|$))/;
const LIST_MARKER = /^(?:[-*•·]\s+|\d{1,2}(?:[.)）](?!\d)|、)\s*|[（(]\d{1,2}[)）]\s*|\[\d{1,2}\]\s*)/;
const WRAPPING_QUOTES = /^["'“‘「『]([^"'“”‘’「」『』]*)["'”’」』],?$/;
const JSON_PUNCTUATION_LINE = /^[\s{}[\],:"'`]*$/;
const JSON_KEY_LINE = /^(?:"[\w-]+"|'[\w-]+')\s*:\s*[[{]?$|^[\w-]+\s*:\s*[[{]$/;
const PREAMBLE_LINE = /[:：]$/;
/** The placeholder items of JSON_SHAPE; a model that echoes them has not answered. */
const PROMPT_EXAMPLE = /^comment\s*\d+$/i;
const COMMENT_TEXT_KEYS = ["text", "content", "comment"] as const;
const STRING_ESCAPES: Record<string, string> = { n: "\n", r: "\r", t: "\t", b: "\b", f: "\f" };
const TRAILING_NOISE = /[\p{P}\p{S}\s\u200d\ufe0f\u20e3]+$/u;

const graphemeSegmenter =
  typeof Intl.Segmenter === "function"
    ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
    : undefined;

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

/** Removes <think>/<thinking> reasoning that some servers inline into the answer. */
export function stripReasoning(text: string): string {
  let visible = text.replace(REASONING_BLOCK, "");
  const lastClose = [...visible.matchAll(REASONING_CLOSE)].at(-1);
  if (lastClose?.index !== undefined) {
    // The opening tag came from the chat template, so everything before the close is reasoning.
    visible = visible.slice(lastClose.index + lastClose[0].length);
  }

  const unclosed = REASONING_OPEN.exec(visible);
  if (unclosed) {
    visible = visible.slice(0, unclosed.index);
  }

  return visible.trim();
}

function arrayLiteralAt(raw: string, start: number): string {
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

/** The (possibly truncated) array literal that is the value of `key`. */
export function arrayLiteralFromKey(raw: string, key: string): string | undefined {
  const match = new RegExp(`["']?${key}["']?\\s*:\\s*\\[`, "i").exec(raw);
  if (!match) {
    return undefined;
  }

  return arrayLiteralAt(raw, match.index + match[0].length - 1);
}

function firstArrayLiteral(raw: string): string | undefined {
  const start = raw.indexOf("[");
  return start < 0 ? undefined : arrayLiteralAt(raw, start);
}

/** Top-level string items of a JSON-like array literal; unterminated items are dropped. */
export function parseQuotedStringArray(raw: string): string[] {
  const items: string[] = [];
  let quote: string | undefined;
  let current = "";
  let depth = 0;

  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index];

    if (!quote) {
      if (char === "[" || char === "{") {
        depth += 1;
      } else if (char === "]" || char === "}") {
        depth -= 1;
      } else if (char === '"' || char === "'") {
        quote = char;
        current = "";
      }
      continue;
    }

    if (char === "\\") {
      const next = raw[index + 1] ?? "";
      const hex = raw.slice(index + 2, index + 6);
      if (next === "u" && /^[0-9a-f]{4}$/i.test(hex)) {
        current += String.fromCharCode(Number.parseInt(hex, 16));
        index += 5;
      } else {
        current += STRING_ESCAPES[next] ?? next;
        index += 1;
      }
      continue;
    }

    if (char === quote) {
      if (depth <= 1) {
        items.push(current.trim());
      }
      quote = undefined;
      continue;
    }

    current += char;
  }

  return items.filter(Boolean);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function coerceComment(item: unknown): string | undefined {
  if (typeof item === "string") {
    return item.trim() || undefined;
  }

  if (typeof item === "number" && Number.isFinite(item)) {
    return String(item);
  }

  if (!isRecord(item)) {
    return undefined;
  }

  const key = COMMENT_TEXT_KEYS.find((name) => typeof item[name] === "string" || typeof item[name] === "number");
  return key ? coerceComment(item[key]) : undefined;
}

function commentList(items: unknown[]): string[] {
  return items.map(coerceComment).filter((text): text is string => text !== undefined);
}

function commentsFromJson(value: unknown): string[] {
  if (Array.isArray(value)) {
    return commentList(value);
  }

  if (!isRecord(value)) {
    return commentList([value]);
  }

  if ("comments" in value) {
    const comments = value.comments;
    return commentList(Array.isArray(comments) ? comments : [comments]);
  }

  const firstArray = Object.values(value).find((entry): entry is unknown[] => Array.isArray(entry));
  return commentList(firstArray ?? [value]);
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/** JSON wrapped in prose ("好的：{...}"); prose such as "第[3]关" does not count. */
function embeddedJson(text: string): unknown {
  const start = text.search(/[[{]/);
  const end = Math.max(text.lastIndexOf("}"), text.lastIndexOf("]"));
  if (start < 0 || end <= start) {
    return undefined;
  }

  const value = parseJson(text.slice(start, end + 1));
  const isAnswer = Array.isArray(value)
    ? value.some((item) => typeof item === "string")
    : isRecord(value);
  return isAnswer ? value : undefined;
}

function isJsonFragment(line: string): boolean {
  return line.startsWith("```") || JSON_PUNCTUATION_LINE.test(line) || JSON_KEY_LINE.test(line);
}

function cleanListLine(line: string): string {
  return line.replace(LIST_MARKER, "").trim().replace(WRAPPING_QUOTES, "$1").trim();
}

function commentsFromLines(text: string): string[] {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length > 1 && PREAMBLE_LINE.test(lines[0])) {
    lines.shift();
  }

  return lines
    .filter((line) => !isJsonFragment(line))
    .map(cleanListLine)
    .filter(Boolean);
}

function commentsFromText(body: string): string[] {
  const parsed = parseJson(body);
  const json = parsed !== undefined ? parsed : embeddedJson(body);
  if (json !== undefined) {
    return commentsFromJson(json);
  }

  // Broken or truncated JSON: keep the strings that were closed, never show the markup.
  const literal =
    arrayLiteralFromKey(body, "comments") ??
    (JSON_START.test(body) ? (firstArrayLiteral(body) ?? "") : undefined);
  if (literal !== undefined) {
    return parseQuotedStringArray(literal);
  }

  return commentsFromLines(body);
}

export function parseModelText(raw: string): string[] {
  const text = stripReasoning(raw);
  const body = CODE_FENCE.exec(text)?.[1]?.trim() || text;
  return commentsFromText(body).filter((item) => !PROMPT_EXAMPLE.test(item));
}

export interface CompletionOutput {
  /** The answer with inline reasoning removed; this is what history keeps. */
  text: string;
  /** The content exactly as the server returned it, for the generation log. */
  rawText: string;
  comments: string[];
  finishReason?: string;
}

function emptyCompletionProblem(
  text: string,
  finishReason: string | undefined,
  reasoned: boolean,
  maxTokens: number,
): string | undefined {
  if (finishReason === "length") {
    return reasoned && !text
      ? `模型的思考过程用完了 max_tokens（${maxTokens}），没有输出弹幕。请调大 Max Tokens，或换用不思考（no-think）的模型。`
      : `输出在 max_tokens（${maxTokens}）处被截断，没有一条完整的弹幕。请调大 Max Tokens。`;
  }

  if (!text) {
    const reason = finishReason ?? "未知";
    return reasoned
      ? `模型只输出了思考过程，没有弹幕（finish_reason=${reason}）。`
      : `模型返回了空内容（finish_reason=${reason}）。`;
  }

  return undefined;
}

/** Reads the answer of a completion, throwing on error bodies and empty or reasoning-only output. */
export function readCompletion(response: ChatCompletionResponse, maxTokens: number): CompletionOutput {
  const apiError = errorText(response.error);
  if (apiError) {
    throw new Error(`模型服务返回了错误：${apiError}`);
  }

  const choice = response.choices?.[0];
  if (!choice) {
    throw new Error("模型响应里没有 choices，无法读取输出。请确认 Base URL 指向 OpenAI 兼容接口。");
  }

  const rawText = textFromContent(response.choices);
  const text = stripReasoning(rawText);
  const comments = parseModelText(text);
  const finishReason = choice.finish_reason ?? undefined;
  if (comments.length === 0) {
    const reasoned =
      Boolean(choice.message?.reasoning_content || choice.message?.reasoning) ||
      text !== rawText.trim();
    const problem = emptyCompletionProblem(text, finishReason, reasoned, maxTokens);
    if (problem) {
      throw new Error(problem);
    }
  }

  return { text, rawText, comments, finishReason };
}

export function normalizedMaxCommentLength(config: AppConfig): number {
  const value = config.danmaku.maxCommentLength ?? COMMENT_LENGTH_DEFAULT;
  if (!Number.isFinite(value)) {
    return COMMENT_LENGTH_DEFAULT;
  }

  return Math.round(clampToRange(value, LIMITS.maxCommentLength));
}

function graphemes(text: string): string[] {
  return graphemeSegmenter
    ? Array.from(graphemeSegmenter.segment(text), (part) => part.segment)
    : Array.from(text);
}

/** Truncates to `maxLength` user-perceived characters, ending with "…". */
export function truncateText(text: string, maxLength: number): string {
  const parts = graphemes(text);
  if (parts.length <= maxLength) {
    return text;
  }

  if (maxLength <= 1) {
    return parts.slice(0, Math.max(0, maxLength)).join("");
  }

  return `${parts.slice(0, maxLength - 1).join("").trimEnd()}…`;
}

function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** Comparison key: width/case/whitespace-insensitive, ignoring trailing punctuation and emoji. */
export function dedupeKey(text: string): string {
  const normalized = collapseWhitespace(text.normalize("NFKC")).toLowerCase();
  return normalized.replace(TRAILING_NOISE, "") || normalized;
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
  const maxCommentLength = normalizedMaxCommentLength(config);
  const seen = new Set<string>();
  // Both the full and the shown text count, so a repeat is caught before and after truncation.
  const keysOf = (text: string) => [dedupeKey(text), dedupeKey(truncateText(text, maxCommentLength))];
  previousComments.forEach((text) => keysOf(collapseWhitespace(text)).forEach((key) => seen.add(key)));

  return items
    .map(collapseWhitespace)
    .filter((text) => text.length > 0)
    .filter((text) => {
      const keys = keysOf(text);
      if (keys.some((key) => seen.has(key))) return false;
      keys.forEach((key) => seen.add(key));
      return true;
    })
    .slice(0, maxItems)
    .map((text, index) => ({
      id: `${Date.now()}-${index}-${Math.random().toString(16).slice(2)}`,
      text: truncateText(text, maxCommentLength),
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
