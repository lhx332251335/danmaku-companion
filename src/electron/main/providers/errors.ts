/** A model request answered with a non-2xx status. */
export class ModelHttpError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ModelHttpError";
    this.status = status;
  }
}

/** The request body is too large: either our own pre-send check or an HTTP 413 from the server. */
export class RequestTooLargeError extends Error {
  readonly requestBytes: number;
  readonly limitBytes?: number;
  readonly serverBody?: string;
  readonly fromServer: boolean;

  constructor(options: {
    message: string;
    requestBytes: number;
    limitBytes?: number;
    serverBody?: string;
    fromServer: boolean;
  }) {
    super(options.message);
    this.name = "RequestTooLargeError";
    this.requestBytes = options.requestBytes;
    this.limitBytes = options.limitBytes;
    this.serverBody = options.serverBody;
    this.fromServer = options.fromServer;
  }
}

export function formatMiB(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
}

/** The message of an API error value: a string, `{ message }` or `{ error: { message } }`. */
export function errorText(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value.trim() || undefined;
  }

  if (typeof value !== "object" || value === null) {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  const nested = errorText(record.message) ?? errorText(record.error) ?? errorText(record.detail);
  if (nested) {
    return nested;
  }

  const code = record.code ?? record.type;
  return typeof code === "string" && code ? code : undefined;
}

const MAX_ERROR_TEXT = 240;
const HTML_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

function clip(text: string): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  return collapsed.length > MAX_ERROR_TEXT ? `${collapsed.slice(0, MAX_ERROR_TEXT - 1)}…` : collapsed;
}

function decodeEntities(text: string): string {
  return text.replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (match, entity: string) => {
    if (!entity.startsWith("#")) {
      return HTML_ENTITIES[entity.toLowerCase()] ?? match;
    }

    const code = /^#x/i.test(entity) ? Number.parseInt(entity.slice(2), 16) : Number.parseInt(entity.slice(1), 10);
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
  });
}

function htmlSummary(html: string): string {
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.trim();
  const text =
    title || html.replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " ");
  return clip(decodeEntities(text));
}

/** A short description of an error body: its JSON error message, an HTML page's <title>, or the text. */
export function summarizeErrorBody(body: string): string {
  const trimmed = body.trim();
  try {
    const message = errorText(JSON.parse(trimmed));
    if (message) {
      return clip(message);
    }
  } catch {
    // Not JSON.
  }

  if (/^<!doctype html|<html[\s>]/i.test(trimmed)) {
    return htmlSummary(trimmed);
  }

  return clip(trimmed);
}

export function httpErrorMessage(status: number, statusText: string, body: string, url: string): string {
  const detail = summarizeErrorBody(body) || statusText;
  return `HTTP ${status}${detail ? `：${detail}` : ""}（${url}）`;
}

function causeText(error: unknown): string | undefined {
  let cause = typeof error === "object" && error !== null ? (error as { cause?: unknown }).cause : undefined;
  if (cause instanceof AggregateError && cause.errors.length > 0) {
    cause = cause.errors[0];
  }

  if (typeof cause === "string") {
    return cause || undefined;
  }

  if (!(cause instanceof Error)) {
    return undefined;
  }

  const code = (cause as { code?: unknown }).code;
  if (!cause.message) {
    return typeof code === "string" ? code : undefined;
  }

  return typeof code === "string" && !cause.message.includes(code) ? `${code} ${cause.message}` : cause.message;
}

/** Turns fetch failures ("fetch failed", timeouts) into a message with the endpoint and the cause. */
export function describeFetchError(
  error: unknown,
  url: string,
  timeoutMs: number,
  timedOut: boolean,
): string {
  if (timedOut || (error instanceof Error && error.name === "TimeoutError")) {
    const seconds = Math.round(timeoutMs / 100) / 10;
    return `请求超时：${seconds} 秒内没有收到响应（${url}）。可以调大 Timeout，或检查模型服务是否过载。`;
  }

  const message = error instanceof Error ? error.message : String(error);
  const cause = causeText(error);
  const detail = cause && !message.includes(cause) ? `${message}：${cause}` : message;
  return `无法连接模型服务：${detail}（${url}）`;
}
