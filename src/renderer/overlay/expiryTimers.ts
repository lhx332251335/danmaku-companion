type TimerHandle = ReturnType<typeof setTimeout>;

/** One removal timer per id, armed once; adding other ids never re-arms existing ones. */
export interface ExpiryTimers {
  schedule(id: string, delayMs: number, onExpire: () => void): void;
  cancel(id: string): void;
  clear(): void;
  readonly size: number;
}

export function createExpiryTimers(
  setTimer: (callback: () => void, delayMs: number) => TimerHandle = (callback, delayMs) =>
    setTimeout(callback, delayMs),
  clearTimer: (handle: TimerHandle) => void = (handle) => clearTimeout(handle),
): ExpiryTimers {
  const timers = new Map<string, TimerHandle>();

  function cancel(id: string): void {
    const handle = timers.get(id);
    if (handle !== undefined) {
      clearTimer(handle);
      timers.delete(id);
    }
  }

  return {
    schedule(id, delayMs, onExpire) {
      cancel(id);
      const handle = setTimer(() => {
        timers.delete(id);
        onExpire();
      }, Math.max(0, delayMs));
      timers.set(id, handle);
    },
    cancel,
    clear() {
      timers.forEach((handle) => clearTimer(handle));
      timers.clear();
    },
    get size() {
      return timers.size;
    },
  };
}
