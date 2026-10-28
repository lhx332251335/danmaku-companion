import { useEffect, useRef, useState } from "react";
import type { RuntimeStatus } from "../../shared/types";
import { countdownState, type CountdownState } from "./format";

/**
 * The current time, refreshed every `intervalMs` while `active`. Use it only in the small
 * component that shows a ticking value, so whole pages do not re-render several times a second.
 */
export function useNow(intervalMs = 1000, active = true): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!active) return undefined;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs, active]);

  return now;
}

/**
 * Countdown to the next capture, ticking only while one is scheduled. Older main processes
 * did not send nextCycleArmedAt; the time this component first saw nextCycleAt stands in.
 */
export function useCountdown(
  status: Pick<RuntimeStatus, "state" | "nextCycleAt" | "nextCycleArmedAt" | "nextCycleIsFirst">,
  intervalMs = 250,
): CountdownState {
  const scheduled = Boolean(status.nextCycleAt);
  const now = useNow(intervalMs, scheduled);
  const seenRef = useRef<{ dueAt?: string; seenAt: number }>({ seenAt: Date.now() });
  if (seenRef.current.dueAt !== status.nextCycleAt) {
    seenRef.current = { dueAt: status.nextCycleAt, seenAt: Date.now() };
  }

  return countdownState(status, scheduled ? Math.max(now, seenRef.current.seenAt) : now, seenRef.current.seenAt);
}
