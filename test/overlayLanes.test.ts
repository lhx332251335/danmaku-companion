import { describe, expect, it } from "vitest";
import {
  BATCH_STAGGER_MS,
  laneLayout,
  laneReadyAt,
  placeComment,
  planDanmaku,
  pruneOccupants,
  resolveOverlayStyle,
  scrollVelocity,
  travelDurationMs,
  type LaneLayout,
  type LaneOccupant,
  type OverlayStyle,
  type PlacementOptions,
} from "../src/renderer/overlay/lanes";
import type { DanmakuItem } from "../src/shared/types";

const viewport = { width: 1920, height: 1080 };

function makeStyle(overrides: Partial<OverlayStyle> = {}): OverlayStyle {
  return { fontSize: 22, speedSeconds: 10, density: 1, zone: "full", ...overrides };
}

function makeItem(id: string, text = "弹幕", overrides: Partial<DanmakuItem> = {}): DanmakuItem {
  return { id, text, createdAt: "2026-01-01T00:00:00.000Z", source: "model", ...overrides };
}

function options(overrides: Partial<PlacementOptions> = {}): PlacementOptions {
  return {
    viewportWidth: viewport.width,
    gapPx: 44,
    maxWaitMs: 4000,
    random: () => 0,
    ...overrides,
  };
}

function occupant(top: number, overrides: Partial<LaneOccupant> = {}): LaneOccupant {
  return { top, height: 32, startAt: 0, width: 400, velocity: 0.192, ...overrides };
}

/** Deterministic PRNG so the simulation is reproducible. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

describe("resolveOverlayStyle", () => {
  it("uses the defaults when the config is missing", () => {
    expect(resolveOverlayStyle()).toEqual({
      fontSize: 22,
      speedSeconds: 10,
      density: 0.6,
      zone: "full",
    });
  });

  it("replaces values that would break the lane math", () => {
    const style = resolveOverlayStyle({
      fontSize: 0,
      speedSeconds: Number.NaN,
      density: 5,
      zone: "toString" as never,
    });
    expect(style).toEqual({ fontSize: 22, speedSeconds: 10, density: 1, zone: "full" });
  });
});

describe("laneLayout", () => {
  it("derives the lane height from the font size and stacks lanes without gaps or overlap", () => {
    const layout = laneLayout(makeStyle({ fontSize: 22 }), viewport.height);
    expect(layout.laneHeight).toBe(32);
    layout.tops.slice(1).forEach((top, index) => {
      expect(top - layout.tops[index]).toBe(layout.laneHeight);
    });
    expect(laneLayout(makeStyle({ fontSize: 44 }), viewport.height).tops.length).toBeLessThan(
      layout.tops.length / 1.8,
    );
  });

  it("keeps every lane inside its zone", () => {
    const bands = { full: [0, 1080], top: [0, 400], middle: [360, 720], bottom: [660, 1000] };
    for (const zone of ["full", "top", "middle", "bottom"] as const) {
      const layout = laneLayout(makeStyle({ zone }), viewport.height);
      const [min, max] = bands[zone];
      expect(layout.tops[0]).toBeGreaterThanOrEqual(min);
      expect(layout.tops[layout.tops.length - 1] + layout.laneHeight).toBeLessThanOrEqual(max);
    }
    const top = laneLayout(makeStyle({ zone: "top" }), viewport.height);
    const bottom = laneLayout(makeStyle({ zone: "bottom" }), viewport.height);
    expect(top.tops[top.tops.length - 1]).toBeLessThan(bottom.tops[0]);
  });

  it("uses density as the fraction of lanes, spread over the zone", () => {
    const all = laneLayout(makeStyle({ density: 1 }), viewport.height);
    expect(all.preferred).toEqual(all.tops.map((_, lane) => lane));

    const half = laneLayout(makeStyle({ density: 0.5 }), viewport.height);
    expect(half.preferred).toHaveLength(Math.round(half.tops.length / 2));
    expect(new Set(half.preferred).size).toBe(half.preferred.length);
    expect(half.preferred[0]).toBe(0);
    expect(half.preferred[half.preferred.length - 1]).toBeGreaterThanOrEqual(half.tops.length - 2);
  });

  it("always offers at least one lane", () => {
    expect(laneLayout(makeStyle({ density: 0 }), viewport.height).preferred).toEqual([0]);
    const tiny = laneLayout(makeStyle({ fontSize: 48 }), 40);
    expect(tiny.tops).toHaveLength(1);
    expect(tiny.preferred).toEqual([0]);
  });
});

describe("motion", () => {
  it("moves every comment at the same speed and lets long ones leave completely", () => {
    const velocity = scrollVelocity(1920, 10);
    expect(velocity).toBeCloseTo(0.192);
    const duration = travelDurationMs(1600, 1920, velocity);
    expect(duration).toBeCloseTo(18333.33, 1);
    expect(duration * velocity).toBeCloseTo(1920 + 1600);
  });
});

describe("laneReadyAt", () => {
  it("is free when nothing shares the lane", () => {
    expect(laneReadyAt([occupant(64)], 0, 32, 0.192, options())).toBe(Number.NEGATIVE_INFINITY);
  });

  it("waits until the previous tail is a gap inside the screen", () => {
    const readyAt = laneReadyAt([occupant(0)], 0, 32, 0.192, options());
    expect(readyAt).toBeCloseTo((400 + 44) / 0.192);
  });

  it("holds back a faster comment until it can no longer catch up", () => {
    const slow = occupant(0, { width: 100, velocity: 0.1 });
    const readyAt = laneReadyAt([slow], 0, 32, 0.3, options());
    const slowTailLeavesAt = (1920 + 100) / 0.1;
    expect(readyAt).toBeCloseTo(slowTailLeavesAt - 1920 / 0.3);
    const followerHeadWhenSlowLeaves = 1920 - 0.3 * (slowTailLeavesAt - readyAt);
    expect(followerHeadWhenSlowLeaves).toBeCloseTo(0);
  });
});

describe("placeComment", () => {
  const layout: LaneLayout = { laneHeight: 32, tops: [0, 32, 64, 96], preferred: [0, 2] };

  it("picks among the free preferred lanes", () => {
    expect(placeComment([], layout, 100, 0.192, options({ random: () => 0 }))).toEqual({
      lane: 0,
      startAt: 100,
      overlapping: false,
    });
    expect(placeComment([], layout, 100, 0.192, options({ random: () => 0.99 })).lane).toBe(2);
    expect(placeComment([occupant(0)], layout, 100, 0.192, options()).lane).toBe(2);
  });

  it("waits briefly for a preferred lane before using the others", () => {
    const busy = [occupant(0, { startAt: 0 }), occupant(64, { startAt: -1000 })];
    const placement = placeComment(busy, layout, 100, 0.192, options());
    expect(placement.lane).toBe(2);
    expect(placement.startAt).toBeCloseTo(-1000 + 444 / 0.192);
    expect(placement.overlapping).toBe(false);
  });

  it("spills into the other lanes when the preferred ones stay busy too long", () => {
    const long = { width: 3000 };
    const busy = [occupant(0, long), occupant(64, long)];
    const placement = placeComment(busy, layout, 100, 0.192, options({ random: () => 0 }));
    expect(placement).toEqual({ lane: 1, startAt: 100, overlapping: false });
  });

  it("overlaps the lane that frees first once the whole zone stays busy", () => {
    const busy = layout.tops.map((top, lane) => occupant(top, { width: 3000 + lane * 100 }));
    const placement = placeComment(busy, layout, 100, 0.192, options());
    expect(placement).toEqual({ lane: 0, startAt: 4100, overlapping: true });
  });
});

describe("planDanmaku", () => {
  const style = makeStyle({ density: 1 });
  const measureWidth = (text: string) => text.length * 22;

  it("staggers a batch into separate lanes and times each by its own width", () => {
    const text = "八个字的一条弹幕";
    const longText = "长".repeat(70);
    const batch = [makeItem("a", text), makeItem("b", text), makeItem("c", longText)];
    const plan = planDanmaku([], batch, {
      now: 5000,
      viewport,
      style,
      measureWidth,
      random: () => 0,
    });
    expect(plan.items.map((item) => item.delayMs)).toEqual([
      0,
      BATCH_STAGGER_MS,
      2 * BATCH_STAGGER_MS,
    ]);
    expect(new Set(plan.items.map((item) => item.top)).size).toBe(3);
    const velocity = scrollVelocity(1920, 10);
    expect(plan.items[2].durationMs * velocity).toBeCloseTo(1920 + longText.length * 22);
    expect(plan.occupants).toHaveLength(3);
  });

  it("reuses a lane once a short comment has moved far enough", () => {
    const batch = ["a", "b", "c"].map((id) => makeItem(id, "短弹幕"));
    const plan = planDanmaku([], batch, {
      now: 0,
      viewport,
      style,
      measureWidth,
      random: () => 0,
    });
    expect(plan.items.map((item) => item.top)).toEqual([
      plan.items[0].top,
      plan.items[0].top + 32,
      plan.items[0].top,
    ]);
  });

  it("uses the item's own speed when it has one", () => {
    const plan = planDanmaku([], [makeItem("a", "ab", { speedSeconds: 20 })], {
      now: 0,
      viewport,
      style,
      measureWidth,
    });
    expect(plan.items[0].durationMs).toBeCloseTo((1920 + 44) / scrollVelocity(1920, 20));
  });

  it("forgets comments once they have left the screen", () => {
    const first = planDanmaku([], [makeItem("a")], { now: 0, viewport, style, measureWidth });
    const duration = first.items[0].durationMs;
    expect(pruneOccupants(first.occupants, duration - 1, 1920)).toHaveLength(1);
    expect(pruneOccupants(first.occupants, duration, 1920)).toHaveLength(0);
    const later = planDanmaku(first.occupants, [makeItem("b")], {
      now: duration + 1,
      viewport,
      style,
      measureWidth,
    });
    expect(later.occupants).toHaveLength(1);
  });

  it("keeps comments in a lane apart under a busy random stream", () => {
    const random = seeded(7);
    const narrow = makeStyle({ zone: "top", fontSize: 40, density: 0.5 });
    const placed: Array<{ occupant: LaneOccupant; overlapping: boolean }> = [];
    let occupants: LaneOccupant[] = [];
    let now = 0;
    const layout = laneLayout(narrow, viewport.height);
    for (let index = 0; index < 400; index += 1) {
      now += random() * 3000;
      occupants = pruneOccupants(occupants, now, viewport.width);
      const width = 80 + random() * 1200;
      const velocity = scrollVelocity(viewport.width, 8 + random() * 6);
      const placement = placeComment(occupants, layout, now, velocity, {
        viewportWidth: viewport.width,
        gapPx: narrow.fontSize * 2,
        maxWaitMs: 4000,
        random,
      });
      const entry: LaneOccupant = {
        top: layout.tops[placement.lane],
        height: layout.laneHeight,
        startAt: placement.startAt,
        width,
        velocity,
      };
      expect(placement.startAt).toBeGreaterThanOrEqual(now);
      expect(placement.startAt).toBeLessThanOrEqual(now + 4000);
      occupants.push(entry);
      placed.push({ occupant: entry, overlapping: placement.overlapping });
    }

    const head = (item: LaneOccupant, time: number) =>
      viewport.width - item.velocity * (time - item.startAt);
    const exit = (item: LaneOccupant) =>
      item.startAt + travelDurationMs(item.width, viewport.width, item.velocity);
    let checkedPairs = 0;
    for (const later of placed.filter((entry) => !entry.overlapping)) {
      for (const { occupant: earlier } of placed) {
        const b = later.occupant;
        if (earlier === b || earlier.top !== b.top || earlier.startAt >= b.startAt) {
          continue;
        }
        const end = Math.min(exit(earlier), exit(b));
        if (end <= b.startAt) {
          continue;
        }
        checkedPairs += 1;
        for (const time of [b.startAt, end]) {
          expect(head(b, time)).toBeGreaterThanOrEqual(head(earlier, time) + earlier.width - 1e-6);
        }
      }
    }
    expect(checkedPairs).toBeGreaterThan(50);
    expect(placed.filter((entry) => entry.overlapping).length).toBeLessThan(placed.length * 0.05);
  });
});
