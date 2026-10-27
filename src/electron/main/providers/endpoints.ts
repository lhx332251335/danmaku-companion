const VERSION_SEGMENT = /\/v\d+[a-z0-9]*(?:\/|$)/i;
const ENDPOINT_SUFFIX = /\/(?:chat\/completions|completions|models)$/i;
const LM_STUDIO_SUFFIX = /\/v1$/i;

interface ApiBase {
  /** Origin and path prefix without a trailing slash, e.g. "https://host/v1". */
  base: string;
  /** Query string kept on every request, e.g. "?api-version=1". */
  search: string;
}

function parseApiBase(baseUrl: string): ApiBase {
  const trimmed = baseUrl.trim();
  let url: URL | undefined;
  try {
    url = new URL(trimmed);
  } catch {
    url = undefined;
  }

  if (!url || (url.protocol !== "http:" && url.protocol !== "https:")) {
    throw new Error(
      trimmed
        ? `Base URL 无效：${trimmed}。需要以 http:// 或 https:// 开头，例如 http://127.0.0.1:1234/v1`
        : "Base URL 未填写。",
    );
  }

  const typedPath = url.pathname.replace(/\/+$/, "");
  const path = typedPath.replace(ENDPOINT_SUFFIX, "").replace(/\/+$/, "");
  const search = url.search;
  // A pasted endpoint tells us the exact prefix. A typed base gets the conventional /v1 unless its
  // path already has a version segment (/v1, /v1beta/openai, /v1/account/gateway/openai, ...).
  const pastedEndpoint = path !== typedPath;
  url.pathname = pastedEndpoint || VERSION_SEGMENT.test(path) ? path || "/v1" : `${path}/v1`;
  url.search = "";
  url.hash = "";
  return { base: url.href.replace(/\/+$/, ""), search };
}

export function normalizeApiBase(baseUrl: string): string {
  const { base, search } = parseApiBase(baseUrl);
  return `${base}${search}`;
}

export function endpoint(baseUrl: string, path: "chat/completions" | "models"): string {
  const { base, search } = parseApiBase(baseUrl);
  return `${base}/${path}${search}`;
}

/**
 * LM Studio's native model lists, next to its /v1 API (keeping a reverse proxy's path prefix).
 * Other bases are not probed, so the API key only goes to paths under the configured prefix.
 */
export function lmStudioModelEndpoints(
  baseUrl: string,
): { native: string; legacy: string } | undefined {
  const { base, search } = parseApiBase(baseUrl);
  if (!LM_STUDIO_SUFFIX.test(base)) {
    return undefined;
  }

  const root = base.replace(LM_STUDIO_SUFFIX, "");
  return {
    native: `${root}/api/v1/models${search}`,
    legacy: `${root}/api/v0/models${search}`,
  };
}

export function buildHeaders(apiKey: string, extra?: Record<string, string>): Record<string, string> {
  const trimmedKey = apiKey.trim();
  return {
    ...extra,
    ...(trimmedKey ? { Authorization: `Bearer ${trimmedKey}` } : {}),
  };
}
