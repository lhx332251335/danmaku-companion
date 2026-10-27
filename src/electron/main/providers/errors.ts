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
