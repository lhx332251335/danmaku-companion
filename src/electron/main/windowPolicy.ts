function parseUrl(value: string): URL | undefined {
  try {
    return new URL(value);
  } catch {
    return undefined;
  }
}

/**
 * Whether a navigation target belongs to the app itself: the same origin as the dev server, or
 * the same renderer index.html file (any query or hash).
 */
export function isAppUrl(candidate: string, entryUrl: string): boolean {
  const target = parseUrl(candidate);
  const entry = parseUrl(entryUrl);
  if (!target || !entry || target.protocol !== entry.protocol) {
    return false;
  }

  if (entry.protocol === "file:") {
    return target.host === entry.host && target.pathname === entry.pathname;
  }

  return (entry.protocol === "http:" || entry.protocol === "https:") && target.origin === entry.origin;
}
