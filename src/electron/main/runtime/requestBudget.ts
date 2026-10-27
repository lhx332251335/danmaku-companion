import type { DanmakuHistoryRound, ScreenSnapshot } from "../../../shared/types";
import { OMITTED_SCREENSHOT_NOTE } from "../providers/messageBuilder";

/**
 * Request-size budgeting for screenshot history.
 *
 * OpenAI-compatible servers usually cap the request body (llm_api: 64 MiB) and every history image
 * is a base64 data URL inside the JSON body. Prefix caching on llama.cpp-style servers only reuses
 * the longest unchanged token prefix, so the budget is enforced in rare batches: nothing changes
 * while the request is under its limits, and once a limit is exceeded the oldest history images
 * are dropped (their text stays) until the request is back under a low-water mark. Each batch
 * costs one cache miss; the rounds in between keep appending to a stable prefix.
 */

export interface RequestBudget {
  /** Hard ceiling for the serialized request body, in bytes. */
  maxBodyBytes: number;
  /** Maximum number of screenshots kept in history (the current screenshot is not counted). */
  maxHistoryImages: number;
}

export interface RequestShape {
  /** Rendered system prompt. */
  systemText: string;
  /** Rendered user text for the current turn. */
  userText: string;
  /** Screenshot for the current turn, if one is sent. */
  snapshot?: ScreenSnapshot;
  /** Model id, sent once in the body. */
  model: string;
  /** Whether images are sent at all; history snapshots are ignored when false. */
  visionEnabled: boolean;
}

export type CompactionReason = "images" | "bytes";

export interface CompactionPlan {
  /** Indexes into the history array whose screenshot should be dropped. */
  dropImageIndexes: number[];
  reason?: CompactionReason;
  /** Upper bound of the body size after applying the plan. */
  estimatedBodyBytes: number;
  /** History screenshots that remain after applying the plan. */
  historyImages: number;
  /** True when even with every history screenshot dropped the request exceeds maxBodyBytes. */
  overBudget: boolean;
}

/** Fraction of each limit that a compaction batch shrinks the request to. */
export const LOW_WATER_RATIO = 0.5;

// Generous per-message allowances for JSON punctuation and keys, so estimates stay upper bounds.
const BODY_OVERHEAD_BYTES = 512;
const MESSAGE_OVERHEAD_BYTES = 64;
const PART_OVERHEAD_BYTES = 64;

export function utf8ByteLength(text: string): number {
  let bytes = 0;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code < 0x80) {
      bytes += 1;
    } else if (code < 0x800) {
      bytes += 2;
    } else if (code >= 0xd800 && code <= 0xdbff && index + 1 < text.length) {
      const next = text.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        index += 1;
      } else {
        bytes += 3;
      }
    } else {
      bytes += 3;
    }
  }
  return bytes;
}

/** Bytes a string takes inside a JSON document, quotes and escapes included. */
export function jsonStringBytes(text: string): number {
  return utf8ByteLength(JSON.stringify(text));
}

function imageBytes(snapshot: ScreenSnapshot): number {
  // Data URLs are ASCII; use the real length rather than trusting dataUrlBytes.
  return snapshot.dataUrl.length + PART_OVERHEAD_BYTES;
}

function userTurnBytes(text: string, snapshot: ScreenSnapshot | undefined, omittedNote: boolean): number {
  let bytes = MESSAGE_OVERHEAD_BYTES + PART_OVERHEAD_BYTES + jsonStringBytes(text);
  if (snapshot) {
    bytes += imageBytes(snapshot);
  }
  if (omittedNote) {
    bytes += PART_OVERHEAD_BYTES + jsonStringBytes(OMITTED_SCREENSHOT_NOTE);
  }
  return bytes;
}

function historyRoundBytes(
  round: DanmakuHistoryRound,
  visionEnabled: boolean,
  dropped: boolean,
): number {
  const snapshot = visionEnabled && !dropped ? round.snapshot : undefined;
  const omitted = Boolean(round.imageOmitted) || (dropped && Boolean(round.snapshot));
  return (
    userTurnBytes(round.userText, snapshot, omitted) +
    MESSAGE_OVERHEAD_BYTES +
    jsonStringBytes(round.assistantText)
  );
}

/** Upper bound of the serialized chat-completions body for this history and current turn. */
export function estimateRequestBytes(
  history: DanmakuHistoryRound[],
  shape: RequestShape,
  dropped: ReadonlySet<number> = new Set(),
): number {
  let bytes =
    BODY_OVERHEAD_BYTES +
    jsonStringBytes(shape.model) +
    MESSAGE_OVERHEAD_BYTES +
    jsonStringBytes(shape.systemText) +
    userTurnBytes(shape.userText, shape.visionEnabled ? shape.snapshot : undefined, false);

  history.forEach((round, index) => {
    bytes += historyRoundBytes(round, shape.visionEnabled, dropped.has(index));
  });

  return bytes;
}

function countImages(history: DanmakuHistoryRound[], dropped: ReadonlySet<number>): number {
  return history.reduce(
    (count, round, index) => count + (round.snapshot && !dropped.has(index) ? 1 : 0),
    0,
  );
}

/**
 * Decide which history screenshots to drop before sending.
 *
 * Returns an empty plan while the request is within both limits, so steady-state rounds leave the
 * prefix untouched. When a limit is exceeded, drops the oldest screenshots until the image count
 * and body size are at or below LOW_WATER_RATIO of their limits.
 */
export function planCompaction(
  history: DanmakuHistoryRound[],
  shape: RequestShape,
  budget: RequestBudget,
): CompactionPlan {
  const dropped = new Set<number>();
  const imageIndexes = shape.visionEnabled
    ? history.flatMap((round, index) => (round.snapshot ? [index] : []))
    : [];
  const maxImages = Math.max(0, Math.floor(budget.maxHistoryImages));
  const maxBytes = Math.max(0, budget.maxBodyBytes);

  let estimatedBodyBytes = estimateRequestBytes(history, shape, dropped);
  let reason: CompactionReason | undefined;
  if (estimatedBodyBytes > maxBytes) {
    reason = "bytes";
  } else if (imageIndexes.length > maxImages) {
    reason = "images";
  }

  if (reason) {
    const lowWaterImages = Math.floor(maxImages * LOW_WATER_RATIO);
    const lowWaterBytes = maxBytes * LOW_WATER_RATIO;
    for (const index of imageIndexes) {
      if (
        imageIndexes.length - dropped.size <= lowWaterImages &&
        estimatedBodyBytes <= lowWaterBytes
      ) {
        break;
      }
      dropped.add(index);
      estimatedBodyBytes = estimateRequestBytes(history, shape, dropped);
    }
  }

  return {
    dropImageIndexes: [...dropped],
    reason,
    estimatedBodyBytes,
    historyImages: shape.visionEnabled ? countImages(history, dropped) : 0,
    overBudget: estimatedBodyBytes > maxBytes,
  };
}

/** Bytes the server says it accepts, read from a 413 response body such as llm_api's. */
export function parseBodyLimitFromError(body: string): number | undefined {
  const patterns = [
    /max[_\s-]?body(?:[_\s-]?size)?\D{0,20}(\d{4,})/i,
    /limit\D{0,20}(\d{4,})\s*bytes/i,
    /(\d{4,})\s*bytes/i,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(body);
    if (match) {
      const value = Number(match[1]);
      if (Number.isFinite(value) && value > 0) {
        return value;
      }
    }
  }
  return undefined;
}

/**
 * Body limit to use after a 413: just under the limit the server reported, or half of the
 * rejected body when the server did not say.
 */
export function learnedBodyLimit(rejectedBytes: number, serverBody: string): number {
  const reported = parseBodyLimitFromError(serverBody);
  if (reported !== undefined && reported < rejectedBytes) {
    return Math.floor(reported * 0.95);
  }
  return Math.floor(rejectedBytes * LOW_WATER_RATIO);
}

const UPLOAD_RESET_CODES = new Set(["ECONNRESET", "EPIPE", "UND_ERR_SOCKET"]);

/** Bodies at least this large are assumed rejected for size when the upload is cut off. */
export const UPLOAD_RESET_MIN_BYTES = 8 * 1024 * 1024;

/**
 * True when the connection was reset (anywhere in the cause chain). Servers that enforce a body
 * limit without reading the body, e.g. waitress reached directly on a LAN, close the socket
 * mid-upload instead of returning a 413.
 */
export function isConnectionReset(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current && typeof current === "object"; depth += 1) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string" && UPLOAD_RESET_CODES.has(code)) {
      return true;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}
