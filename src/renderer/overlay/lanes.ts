import { defaultAppConfig } from "../../shared/defaultConfig";
import { clamp } from "../../shared/limits";
import type { DanmakuItem, DanmakuStyleSettings, DanmakuZone } from "../../shared/types";

/** Must match `line-height` of `.danmaku-line`. */
export const DANMAKU_LINE_HEIGHT = 1.25;
/** Vertical space between lanes, in em. */
const LANE_SPACING_EM = 0.2;
/** Horizontal space kept behind the previous comment in a lane, in em. */
const ENTRY_GAP_EM = 2;
/** How long a comment may wait for a free lane before it is allowed to overlap. */
export const MAX_LANE_WAIT_MS = 4000;
/** Comments arriving in one batch enter one after another. */
export const BATCH_STAGGER_MS = 350;

/** Vertical band of each zone as fractions of the viewport height. */
export const ZONE_BANDS: Record<DanmakuZone, readonly [number, number]> = {
  full: [0.06, 0.92],
  top: [0.06, 0.36],
  middle: [0.34, 0.66],
  bottom: [0.62, 0.92],
};

export interface OverlayStyle {
  fontSize: number;
  speedSeconds: number;
  density: number;
  zone: DanmakuZone;
}

export interface Viewport {
  width: number;
  height: number;
}

export interface LaneLayout {
  laneHeight: number;
  /** Top offset (px) of every lane in the zone, top to bottom. */
  tops: number[];
  /** Lanes the density setting uses normally, spread evenly over the zone. */
  preferred: number[];
}

/** A comment that occupies a lane; its head enters at the right edge at `startAt`. */
export interface LaneOccupant {
  top: number;
  height: number;
  startAt: number;
  width: number;
  /** Horizontal speed in px per ms. */
  velocity: number;
}

export interface PlacementOptions {
  viewportWidth: number;
  gapPx: number;
  maxWaitMs: number;
  random: () => number;
}

export interface LanePlacement {
  lane: number;
  startAt: number;
  /** Every lane stayed busy past the wait limit, so this comment may overlap another one. */
  overlapping: boolean;
}

export interface PlannedDanmaku extends DanmakuItem {
  top: number;
  delayMs: number;
  durationMs: number;
}

export interface PlanContext {
  /** Current time in ms, on the same clock as the occupants' `startAt`. */
  now: number;
  viewport: Viewport;
  style: OverlayStyle;
  measureWidth: (text: string) => number;
  random?: () => number;
  maxWaitMs?: number;
}

export interface DanmakuPlan {
  items: PlannedDanmaku[];
  occupants: LaneOccupant[];
}

function positiveOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

function isZone(value: unknown): value is DanmakuZone {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(ZONE_BANDS, value);
}

export function resolveOverlayStyle(danmaku?: Partial<DanmakuStyleSettings>): OverlayStyle {
  const fallback = defaultAppConfig.danmaku;
  const density = danmaku?.density;
  const zone = danmaku?.zone;
  return {
    fontSize: positiveOr(danmaku?.fontSize, fallback.fontSize),
    speedSeconds: positiveOr(danmaku?.speedSeconds, fallback.speedSeconds),
    density:
      typeof density === "number" && Number.isFinite(density)
        ? clamp(density, 0, 1)
        : fallback.density,
    zone: isZone(zone) ? zone : fallback.zone,
  };
}

function spreadIndices(total: number, wanted: number): number[] {
  return Array.from({ length: wanted }, (_, index) => Math.floor((index * total) / wanted));
}

export function laneLayout(style: OverlayStyle, viewportHeight: number): LaneLayout {
  const [startRatio, endRatio] = ZONE_BANDS[style.zone];
  const laneHeight = Math.ceil(style.fontSize * (DANMAKU_LINE_HEIGHT + LANE_SPACING_EM));
  const bandTop = Math.round(viewportHeight * startRatio);
  const bandHeight = Math.max(0, Math.round(viewportHeight * endRatio) - bandTop);
  const count = Math.max(1, Math.floor(bandHeight / laneHeight));
  const preferredCount = Math.max(1, Math.round(count * style.density));
  return {
    laneHeight,
    tops: Array.from({ length: count }, (_, index) => bandTop + index * laneHeight),
    preferred: spreadIndices(count, preferredCount),
  };
}

/** Constant px/ms so that the head of every comment crosses the screen in `speedSeconds`. */
export function scrollVelocity(viewportWidth: number, speedSeconds: number): number {
  return viewportWidth / (speedSeconds * 1000);
}

/** Time until the tail of a comment has left the left edge. */
export function travelDurationMs(width: number, viewportWidth: number, velocity: number): number {
  return (viewportWidth + width) / velocity;
}

function exitAt(occupant: LaneOccupant, viewportWidth: number): number {
  return occupant.startAt + travelDurationMs(occupant.width, viewportWidth, occupant.velocity);
}

function sharesLane(occupant: LaneOccupant, top: number, height: number): boolean {
  return occupant.top < top + height && top < occupant.top + occupant.height;
}

/**
 * Earliest time a comment moving at `velocity` may enter the lane: the previous comment's
 * tail is `gapPx` inside the screen, and a faster follower cannot catch up before it leaves.
 */
export function laneReadyAt(
  occupants: readonly LaneOccupant[],
  top: number,
  height: number,
  velocity: number,
  options: Pick<PlacementOptions, "viewportWidth" | "gapPx">,
): number {
  let readyAt = Number.NEGATIVE_INFINITY;
  for (const occupant of occupants) {
    if (!sharesLane(occupant, top, height)) {
      continue;
    }
    const tailInsideAt = occupant.startAt + (occupant.width + options.gapPx) / occupant.velocity;
    const noCatchUpAt = exitAt(occupant, options.viewportWidth) - options.viewportWidth / velocity;
    readyAt = Math.max(readyAt, tailInsideAt, noCatchUpAt);
  }
  return readyAt;
}

function earliestLane(lanes: readonly number[], readyAt: readonly number[]): number | undefined {
  let best: number | undefined;
  for (const lane of lanes) {
    if (best === undefined || readyAt[lane] < readyAt[best]) {
      best = lane;
    }
  }
  return best;
}

function pickLane(
  lanes: readonly number[],
  readyAt: readonly number[],
  requestedAt: number,
  deadline: number,
  random: () => number,
): number | undefined {
  const free = lanes.filter((lane) => readyAt[lane] <= requestedAt);
  if (free.length > 0) {
    return free[Math.min(free.length - 1, Math.floor(random() * free.length))];
  }
  const soonest = earliestLane(lanes, readyAt);
  return soonest !== undefined && readyAt[soonest] <= deadline ? soonest : undefined;
}

/**
 * Picks a free preferred lane, else waits briefly for one, else spills into the zone's other
 * lanes, and only when the whole zone stays busy overlaps the lane that frees up first.
 */
export function placeComment(
  occupants: readonly LaneOccupant[],
  layout: LaneLayout,
  requestedAt: number,
  velocity: number,
  options: PlacementOptions,
): LanePlacement {
  const readyAt = layout.tops.map((top) =>
    laneReadyAt(occupants, top, layout.laneHeight, velocity, options),
  );
  const deadline = requestedAt + options.maxWaitMs;
  const allLanes = layout.tops.map((_, lane) => lane);
  const otherLanes = allLanes.filter((lane) => !layout.preferred.includes(lane));
  const lane =
    pickLane(layout.preferred, readyAt, requestedAt, deadline, options.random) ??
    pickLane(otherLanes, readyAt, requestedAt, deadline, options.random);

  if (lane !== undefined) {
    return { lane, startAt: Math.max(requestedAt, readyAt[lane]), overlapping: false };
  }

  return { lane: earliestLane(allLanes, readyAt) ?? 0, startAt: deadline, overlapping: true };
}

export function pruneOccupants(
  occupants: readonly LaneOccupant[],
  now: number,
  viewportWidth: number,
): LaneOccupant[] {
  return occupants.filter((occupant) => exitAt(occupant, viewportWidth) > now);
}

/** Assigns a lane, entry delay and duration to each incoming comment. */
export function planDanmaku(
  occupants: readonly LaneOccupant[],
  incoming: readonly DanmakuItem[],
  context: PlanContext,
): DanmakuPlan {
  const { now, style } = context;
  const viewportWidth = Math.max(1, context.viewport.width);
  const layout = laneLayout(style, context.viewport.height);
  const options: PlacementOptions = {
    viewportWidth,
    gapPx: style.fontSize * ENTRY_GAP_EM,
    maxWaitMs: context.maxWaitMs ?? MAX_LANE_WAIT_MS,
    random: context.random ?? Math.random,
  };
  const nextOccupants = pruneOccupants(occupants, now, viewportWidth);
  const items = incoming.map((item, index): PlannedDanmaku => {
    const speedSeconds = positiveOr(item.speedSeconds, style.speedSeconds);
    const velocity = scrollVelocity(viewportWidth, speedSeconds);
    const width = Math.max(0, context.measureWidth(item.text));
    const placement = placeComment(
      nextOccupants,
      layout,
      now + index * BATCH_STAGGER_MS,
      velocity,
      options,
    );
    const top = layout.tops[placement.lane];
    nextOccupants.push({
      top,
      height: layout.laneHeight,
      startAt: placement.startAt,
      width,
      velocity,
    });
    return {
      ...item,
      top,
      delayMs: placement.startAt - now,
      durationMs: travelDurationMs(width, viewportWidth, velocity),
    };
  });

  return { items, occupants: nextOccupants };
}
