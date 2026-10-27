import { describeFetchError, httpErrorMessage, summarizeErrorBody } from "./errors";

export interface TextResponse {
  ok: boolean;
  status: number;
  statusText: string;
  body: string;
}

/**
 * fetch() plus reading the body, under one timeout. Failures name the endpoint and the cause;
 * an abort through `abortSignal` is rethrown unchanged so callers can tell it from a failure.
 */
export async function fetchText(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  abortSignal?: AbortSignal,
): Promise<TextResponse> {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const signal = abortSignal ? AbortSignal.any([abortSignal, timeoutSignal]) : timeoutSignal;

  try {
    const response = await fetch(url, { ...init, signal });
    const body = await response.text();
    return { ok: response.ok, status: response.status, statusText: response.statusText, body };
  } catch (error) {
    if (abortSignal?.aborted) {
      throw error;
    }

    throw new Error(describeFetchError(error, url, timeoutMs, timeoutSignal.aborted), { cause: error });
  }
}

export function parseJsonBody<T>(response: TextResponse, url: string): T {
  try {
    return JSON.parse(response.body) as T;
  } catch {
    throw new Error(`响应不是 JSON：${summarizeErrorBody(response.body) || "空响应"}（${url}）`);
  }
}

export async function fetchJson<T>(url: string, init: RequestInit, timeoutMs: number): Promise<T> {
  const response = await fetchText(url, init, timeoutMs);
  if (!response.ok) {
    throw new Error(httpErrorMessage(response.status, response.statusText, response.body, url));
  }

  return parseJsonBody<T>(response, url);
}
