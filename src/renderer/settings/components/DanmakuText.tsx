import { useId, type CSSProperties, type ElementType, type ReactNode } from "react";
import { danmakuTextClass } from "../../danmakuStyle";

export interface DanmakuTextProps {
  text: string;
  /** Text colour (a palette entry). Default #f8fafc like the overlay. */
  color?: string;
  /** Font size in px (the overlay's danmaku.fontSize); default inherits --danmaku-font-size. */
  fontSize?: number;
  /** 0.2–1 (danmaku.opacity). */
  opacity?: number;
  /** The overlay's soft text shadow (danmaku.shadow). */
  shadow?: boolean;
  /**
   * Scroll across the surrounding DanmakuStage: `top` (CSS length), one crossing every
   * `duration` seconds, starting after `delay`; `x` is the resting position when the user
   * prefers reduced motion.
   */
  fly?: { top: string; duration: number; delay?: number; x?: string };
  as?: ElementType;
  className?: string;
  style?: CSSProperties;
}

/**
 * One danmaku comment in exactly the overlay's text style (styles/overlay.css): weight 800,
 * line-height 1.25, palette colour, opacity, the optional shadow + outline and the faint
 * outline that keeps very light colours readable (danmakuTextClass, shared with the overlay).
 */
export function DanmakuText({
  text,
  color,
  fontSize,
  opacity,
  shadow = false,
  fly,
  as: Tag = "span",
  className,
  style,
}: DanmakuTextProps) {
  const vars: Record<string, string | number> = {};
  if (fontSize !== undefined) vars["--danmaku-font-size"] = `${fontSize}px`;
  if (opacity !== undefined) vars["--danmaku-opacity"] = opacity;
  if (fly) {
    vars["--top"] = fly.top;
    vars["--dur"] = `${fly.duration}s`;
    vars["--delay"] = `${fly.delay ?? 0}s`;
    if (fly.x) vars["--x"] = fly.x;
  }

  return (
    <Tag
      className={[danmakuTextClass(color, shadow), fly ? "dm-fly" : "", className]
        .filter(Boolean)
        .join(" ")}
      style={{ ...vars, color, ...style } as CSSProperties}
    >
      {text}
    </Tag>
  );
}

export interface DanmakuPillProps {
  text: string;
  color?: string;
  title?: string;
}

/** A comment as a small dark pill with a colour dot (log details). */
export function DanmakuPill({ text, color = "#f8fafc", title }: DanmakuPillProps) {
  return (
    <span className="dm-pill" style={{ "--c": color } as CSSProperties} title={title ?? text}>
      <DanmakuText text={text} color={color} />
    </span>
  );
}

export interface DanmakuStageProps {
  /** night: dark game scene (default); document: bright document window. */
  backdrop?: "night" | "document";
  /** Stage height (px or CSS length). Default 220. */
  height?: number | string;
  /** Dashed band showing the display zone, as fractions of the height. */
  zone?: { top: number; bottom: number; label?: string };
  /** Chips at the bottom left, e.g. <span>按当前字号 · 颜色 · 阴影渲染</span>. */
  caption?: ReactNode;
  /** Sentence for screen readers (the stage is role="img"), e.g. listing the comments. */
  label: string;
  className?: string;
  /** DanmakuText elements, usually with `fly`. */
  children?: ReactNode;
}

/**
 * Illustrated mini "screen" for previews. Lines inside use the overlay text style and
 * cross the stage linearly; under reduced motion they rest at their `x` position.
 */
export function DanmakuStage({
  backdrop = "night",
  height = 220,
  zone,
  caption,
  label,
  className,
  children,
}: DanmakuStageProps) {
  return (
    <div
      role="img"
      aria-label={label}
      data-backdrop={backdrop}
      className={["dm-stage", className].filter(Boolean).join(" ")}
      style={{ height }}
    >
      {backdrop === "night" ? <NightScene /> : <DocumentScene />}
      {zone ? (
        <div
          className="dm-stage-zone"
          style={{ top: `${zone.top * 100}%`, height: `${(zone.bottom - zone.top) * 100}%` }}
          aria-hidden="true"
        >
          {zone.label ? <span>{zone.label}</span> : null}
        </div>
      ) : null}
      <div aria-hidden="true">{children}</div>
      {caption ? (
        <div className="dm-stage-caption" aria-hidden="true">
          {caption}
        </div>
      ) : null}
    </div>
  );
}

function NightScene() {
  const id = useId().replace(/:/g, "");
  return (
    <svg
      className="dm-stage-scene"
      viewBox="0 0 400 240"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={`${id}-sky`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#0c1a33" />
          <stop offset=".62" stopColor="#1d2b52" />
          <stop offset="1" stopColor="#3a2f57" />
        </linearGradient>
        <linearGradient id={`${id}-hill`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#24305a" />
          <stop offset="1" stopColor="#1a2346" />
        </linearGradient>
      </defs>
      <rect width="400" height="240" fill={`url(#${id}-sky)`} />
      <g fill="#fff">
        <circle cx="30" cy="30" r="1" opacity=".7" />
        <circle cx="88" cy="18" r="1.2" opacity=".5" />
        <circle cx="140" cy="44" r="1" opacity=".6" />
        <circle cx="196" cy="22" r="1.3" opacity=".7" />
        <circle cx="240" cy="60" r="1" opacity=".5" />
        <circle cx="372" cy="28" r="1.2" opacity=".6" />
        <circle cx="358" cy="92" r="1" opacity=".5" />
        <circle cx="60" cy="80" r="1" opacity=".45" />
        <circle cx="270" cy="16" r="1" opacity=".6" />
      </g>
      <circle cx="318" cy="62" r="42" fill="#ffd9a8" opacity=".1" />
      <circle cx="318" cy="62" r="22" fill="#ffe7bf" />
      <path
        d="M0 168 L44 128 L82 150 L132 98 L184 146 L232 112 L282 150 L334 108 L400 148 V240 H0Z"
        fill={`url(#${id}-hill)`}
      />
      <path d="M0 204 Q64 172 126 194 T252 186 T400 178 V240 H0Z" fill="#131a33" />
      <rect x="54" y="174" width="70" height="9" rx="3" fill="#3a4a7a" />
      <rect x="236" y="156" width="58" height="9" rx="3" fill="#3a4a7a" />
      <rect x="82" y="152" width="13" height="20" rx="5" fill="#ff7a59" />
      <circle cx="91" cy="159" r="1.6" fill="#2a0f08" />
      <circle cx="262" cy="142" r="5" fill="#f2b450" />
      <circle cx="278" cy="136" r="5" fill="#f2b450" opacity=".85" />
      <rect x="12" y="12" width="74" height="9" rx="4.5" fill="#fff" opacity=".14" />
      <rect x="14" y="14" width="46" height="5" rx="2.5" fill="#3ccfd6" />
    </svg>
  );
}

function DocumentScene() {
  return (
    <svg
      className="dm-stage-scene"
      viewBox="0 0 400 240"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
    >
      <rect width="400" height="240" fill="#e8ecf3" />
      <rect x="16" y="12" width="368" height="220" rx="8" fill="#ffffff" />
      <rect x="16" y="12" width="368" height="20" rx="8" fill="#dfe5ee" />
      <rect x="16" y="24" width="368" height="8" fill="#dfe5ee" />
      <circle cx="28" cy="22" r="3" fill="#f2a3a3" />
      <circle cx="38" cy="22" r="3" fill="#f2d39a" />
      <circle cx="48" cy="22" r="3" fill="#a9dcb6" />
      <rect x="16" y="32" width="74" height="200" fill="#f3f5f9" />
      <g fill="#d5dbe5">
        <rect x="26" y="46" width="50" height="6" rx="3" />
        <rect x="26" y="62" width="40" height="6" rx="3" />
        <rect x="26" y="78" width="54" height="6" rx="3" />
        <rect x="26" y="94" width="36" height="6" rx="3" />
      </g>
      <rect x="106" y="46" width="150" height="12" rx="4" fill="#b9c3d3" />
      <g fill="#dde3ec">
        <rect x="106" y="68" width="262" height="6" rx="3" />
        <rect x="106" y="82" width="244" height="6" rx="3" />
        <rect x="106" y="96" width="256" height="6" rx="3" />
        <rect x="106" y="110" width="180" height="6" rx="3" />
      </g>
      <rect x="106" y="126" width="140" height="92" rx="6" fill="#cfeaf0" />
      <path d="M106 206 L146 168 L172 190 L196 172 L246 212 V218 H106Z" fill="#9fd3de" />
      <circle cx="222" cy="148" r="9" fill="#ffffff" opacity=".9" />
      <g fill="#dde3ec">
        <rect x="258" y="130" width="110" height="6" rx="3" />
        <rect x="258" y="144" width="96" height="6" rx="3" />
        <rect x="258" y="158" width="104" height="6" rx="3" />
      </g>
      <rect x="258" y="186" width="66" height="22" rx="6" fill="#ffd8cc" />
    </svg>
  );
}
