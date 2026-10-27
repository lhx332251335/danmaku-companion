import { RequestTooLargeError } from "../providers/errors";

/**
 * Statuses whose cause is usually the request itself (context too long, body too large, an image
 * the server rejects), so sending the same history again fails again. Timeouts, 429 and 5xx are
 * transient and leave history alone.
 */
const REPEATING_CLIENT_STATUSES: ReadonlySet<number> = new Set([400, 413, 422]);

/** HTTP status of a failed model request, from a `status` field or the provider's message. */
export function httpStatusOf(error: unknown): number | undefined {
  if (error instanceof RequestTooLargeError) {
    return 413;
  }

  const status = (error as { status?: unknown } | null)?.status;
  if (typeof status === "number") {
    return status;
  }

  const message = error instanceof Error ? error.message : String(error);
  const match = /\((\d{3})\):|\bHTTP (\d{3})\b/.exec(message);
  return match ? Number(match[1] ?? match[2]) : undefined;
}

/** True when retrying with the same history would fail the same way. */
export function isRepeatingRequestError(error: unknown): boolean {
  const status = httpStatusOf(error);
  return status !== undefined && REPEATING_CLIENT_STATUSES.has(status);
}
