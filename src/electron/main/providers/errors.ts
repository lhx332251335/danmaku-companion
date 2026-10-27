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
