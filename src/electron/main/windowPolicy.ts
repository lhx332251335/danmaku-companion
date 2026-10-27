export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Windows 10 2004 is the first build where WDA_EXCLUDEFROMCAPTURE exists. */
export const WINDOWS_CAPTURE_EXCLUSION_MIN_BUILD = 19041;
/** Minimum time between re-asserting the overlay's topmost state while danmaku are pushed. */
export const OVERLAY_TOPMOST_REFRESH_MS = 10_000;
export const OVERLAY_RECOVERY_WINDOW_MS = 60_000;
export const OVERLAY_RECOVERY_MAX_ATTEMPTS = 5;
const OVERLAY_RECOVERY_BASE_DELAY_MS = 500;
const OVERLAY_RECOVERY_MAX_DELAY_MS = 10_000;

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

/** Build number from os.release() on Windows ("10.0.19045" -> 19045). */
export function windowsBuildNumber(release: string): number | undefined {
  const build = Number.parseInt(release.split(".")[2] ?? "", 10);
  return Number.isFinite(build) ? build : undefined;
}

/**
 * Whether setContentProtection removes a window from screen capture. Before Windows 10 2004 it
 * falls back to WDA_MONITOR, which captures the window as a black rectangle; for the full-screen
 * overlay that would black out the whole screenshot. Electron does nothing on Linux.
 */
export function supportsCaptureExclusion(platform: string, release: string): boolean {
  if (platform === "darwin") {
    return true;
  }
  if (platform !== "win32") {
    return false;
  }

  const build = windowsBuildNumber(release);
  return build !== undefined && build >= WINDOWS_CAPTURE_EXCLUSION_MIN_BUILD;
}

/** Human-readable accelerator for messages ("CommandOrControl+Alt+D" -> "Ctrl+Alt+D"). */
export function formatAccelerator(accelerator: string, platform: string): string {
  return accelerator.replace(/CommandOrControl|CmdOrCtrl/g, platform === "darwin" ? "Cmd" : "Ctrl");
}

export function shouldRefreshTopmost(lastRefreshedAt: number | undefined, now: number): boolean {
  return lastRefreshedAt === undefined || now - lastRefreshedAt >= OVERLAY_TOPMOST_REFRESH_MS;
}

export function sameBounds(a: Bounds, b: Bounds): boolean {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

/** Crash times still inside the recovery window, including `now`. */
export function recordOverlayCrash(crashTimes: readonly number[], now: number): number[] {
  return [...crashTimes.filter((at) => now - at < OVERLAY_RECOVERY_WINDOW_MS), now];
}

/**
 * Delay before recreating a crashed overlay, doubling with each recent crash, or undefined to
 * stop retrying when it keeps crashing.
 */
export function overlayRecoveryDelay(recentCrashes: readonly number[]): number | undefined {
  const attempts = recentCrashes.length;
  if (attempts > OVERLAY_RECOVERY_MAX_ATTEMPTS) {
    return undefined;
  }

  return Math.min(
    OVERLAY_RECOVERY_MAX_DELAY_MS,
    OVERLAY_RECOVERY_BASE_DELAY_MS * 2 ** Math.max(0, attempts - 1),
  );
}
