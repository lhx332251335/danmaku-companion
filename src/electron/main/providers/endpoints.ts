export function normalizeApiBase(baseUrl: string): string {
  let base = baseUrl.trim().replace(/\/+$/, "");
  base = base.replace(/\/chat\/completions$/i, "");
  base = base.replace(/\/models$/i, "");

  if (!/\/v\d+$/i.test(base)) {
    base = `${base}/v1`;
  }

  return base;
}

export function endpoint(baseUrl: string, path: "chat/completions" | "models"): string {
  return `${normalizeApiBase(baseUrl)}/${path}`;
}

export function serverRoot(baseUrl: string): string {
  const normalized = normalizeApiBase(baseUrl);
  try {
    const url = new URL(normalized);
    return url.origin;
  } catch {
    return normalized.replace(/\/v\d+$/i, "");
  }
}

export function buildHeaders(apiKey: string, extra?: Record<string, string>): Record<string, string> {
  const trimmedKey = apiKey.trim();
  return {
    ...extra,
    ...(trimmedKey ? { Authorization: `Bearer ${trimmedKey}` } : {}),
  };
}
