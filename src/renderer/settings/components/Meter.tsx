import type { CSSProperties } from "react";
import type { Tone } from "../format";

export type MeterTone = Exclude<Tone, "neutral">;

export interface MeterProps {
  value: number;
  max: number;
  /** Accessible name, e.g. 请求体. */
  label: string;
  /** Spoken value, e.g. "3.1 / 48 MB". Defaults to "value / max". */
  valueText?: string;
  tone?: MeterTone;
  /** Tick at this fraction of the track (0–1), e.g. 0.5 for the compaction target. */
  mark?: number;
  /** Small text under the tick (e.g. 压缩到此). */
  markLabel?: string;
  size?: "md" | "sm";
  className?: string;
}

/** 8 px (6 px small) track with a coloured fill; role="meter". Tiny values stay visible. */
export function Meter({
  value,
  max,
  label,
  valueText,
  tone = "accent",
  mark,
  markLabel,
  size = "md",
  className,
}: MeterProps) {
  const safeMax = max > 0 ? max : 1;
  const clamped = Math.max(0, Math.min(safeMax, Number.isFinite(value) ? value : 0));
  const percent = (clamped / safeMax) * 100;
  const markPercent =
    mark !== undefined && Number.isFinite(mark) ? Math.max(0, Math.min(1, mark)) * 100 : undefined;

  const meter = (
    <div
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={safeMax}
      aria-valuenow={clamped}
      aria-valuetext={valueText ?? `${value} / ${max}`}
      className={[
        "meter",
        tone !== "accent" ? `tone-${tone}` : "",
        size === "sm" ? "is-sm" : "",
        markLabel ? "" : className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {percent > 0 ? (
        <span
          className="meter-fill"
          style={{ width: `max(6px, ${percent}%)` } as CSSProperties}
        />
      ) : null}
      {markPercent !== undefined ? (
        <span className="meter-mark" style={{ left: `${markPercent}%` }} aria-hidden="true" />
      ) : null}
    </div>
  );

  if (!markLabel || markPercent === undefined) {
    return meter;
  }

  return (
    <div className={["meter-wrap", className].filter(Boolean).join(" ")}>
      {meter}
      <div className="meter-mark-label" aria-hidden="true">
        <span style={{ left: `${markPercent}%` }}>{markLabel}</span>
      </div>
    </div>
  );
}

export interface MiniBar {
  /** Bar height relative to `max`; undefined draws a short muted stub (no data). */
  value?: number;
  tone?: "accent" | "bad" | "warn" | "coral" | "ok" | "muted";
}

export interface MiniBarsProps {
  bars: readonly MiniBar[];
  /** Value of a full-height bar (default: the largest value). */
  max?: number;
  /** Height in px (default 22). */
  height?: number;
  /** Sentence describing the series for screen readers (the chart is role="img"). */
  label: string;
  className?: string;
}

/**
 * Tiny bar series (latency sparkline, cache share per round). Decorative detail next to a
 * stat value, so it is one role="img" with a summary label.
 */
export function MiniBars({ bars, max, height = 22, label, className }: MiniBarsProps) {
  const top =
    max ?? Math.max(1, ...bars.map((bar) => (bar.value !== undefined && Number.isFinite(bar.value) ? bar.value : 0)));

  return (
    <div
      role="img"
      aria-label={label}
      className={["mini-bars", className].filter(Boolean).join(" ")}
      style={{ "--bars-h": `${height}px` } as CSSProperties}
    >
      {bars.map((bar, index) => {
        const ratio =
          bar.value !== undefined && Number.isFinite(bar.value) ? Math.max(0, Math.min(1, bar.value / top)) : 0;
        const tone = bar.value === undefined ? "muted" : (bar.tone ?? "accent");
        return (
          <i
            key={index}
            className={tone !== "accent" ? `tone-${tone}` : undefined}
            style={{ height: `${Math.max(3, Math.round(ratio * height))}px` }}
          />
        );
      })}
    </div>
  );
}
