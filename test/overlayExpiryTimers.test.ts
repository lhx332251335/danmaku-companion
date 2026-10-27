import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createExpiryTimers } from "../src/renderer/overlay/expiryTimers";

describe("createExpiryTimers", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not re-arm earlier timers when new items arrive", () => {
    const timers = createExpiryTimers();
    const expired: string[] = [];
    timers.schedule("a", 11_000, () => expired.push("a"));
    vi.advanceTimersByTime(4_000);
    timers.schedule("b", 11_000, () => expired.push("b"));
    vi.advanceTimersByTime(4_000);
    timers.schedule("c", 11_000, () => expired.push("c"));

    vi.advanceTimersByTime(3_000);
    expect(expired).toEqual(["a"]);
    vi.advanceTimersByTime(4_000);
    expect(expired).toEqual(["a", "b"]);
    vi.advanceTimersByTime(4_000);
    expect(expired).toEqual(["a", "b", "c"]);
    expect(timers.size).toBe(0);
  });

  it("cancels one item or all of them", () => {
    const timers = createExpiryTimers();
    const onExpire = vi.fn();
    timers.schedule("a", 100, onExpire);
    timers.schedule("b", 100, onExpire);
    timers.schedule("c", 100, onExpire);
    timers.cancel("a");
    expect(timers.size).toBe(2);
    timers.clear();
    expect(timers.size).toBe(0);
    vi.advanceTimersByTime(1_000);
    expect(onExpire).not.toHaveBeenCalled();
  });

  it("replaces the timer when the same id is scheduled again", () => {
    const timers = createExpiryTimers();
    const first = vi.fn();
    const second = vi.fn();
    timers.schedule("a", 100, first);
    timers.schedule("a", 300, second);
    vi.advanceTimersByTime(1_000);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
});
