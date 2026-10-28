import type { CSSProperties, ReactNode } from "react";
import type { Tone } from "../format";

export type ChipTone = Tone | "outline";

export interface ChipProps {
  tone?: ChipTone;
  /** Leading icon element. */
  icon?: ReactNode;
  size?: "md" | "sm";
  title?: string;
  className?: string;
  children: ReactNode;
}

/** 24 px pill (22 px small) for facts and tags: neutral, accent, coral, ok, warn, bad, violet. */
export function Chip({ tone = "neutral", icon, size = "md", title, className, children }: ChipProps) {
  return (
    <span
      title={title}
      className={[
        "chip",
        tone !== "neutral" ? `tone-${tone}` : "",
        size === "sm" ? "is-sm" : "",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {icon ? (
        <span className="decor" aria-hidden="true">
          {icon}
        </span>
      ) : null}
      {children}
    </span>
  );
}

export interface BadgeProps {
  tone?: "neutral" | "accent";
  /** Spoken text when the number alone is unclear, e.g. "128 条日志". */
  label?: string;
  children: ReactNode;
}

/** Small count badge (nav). */
export function Badge({ tone = "neutral", label, children }: BadgeProps) {
  return (
    <span className={["badge", "num", tone === "accent" ? "tone-accent" : ""].filter(Boolean).join(" ")}>
      <span aria-hidden={label ? true : undefined}>{children}</span>
      {label ? <span className="sr-only">{label}</span> : null}
    </span>
  );
}

export interface StatusPillProps {
  /** live = coral (running), accent, ok, warn (paused), bad (error), violet, neutral (idle). */
  tone?: "live" | "accent" | "ok" | "warn" | "bad" | "violet" | "neutral";
  /** Show the leading dot. */
  dot?: boolean;
  /** Pulse the dot (running); off under reduced motion. */
  pulse?: boolean;
  className?: string;
  children: ReactNode;
}

/** 26 px state pill: 「● 运行中 · 第 37 轮」. */
export function StatusPill({ tone = "neutral", dot = true, pulse = false, className, children }: StatusPillProps) {
  return (
    <span
      className={[
        "status-pill",
        tone !== "neutral" ? `tone-${tone}` : "",
        pulse ? "is-pulsing" : "",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {dot ? <span className="pill-dot" aria-hidden="true" /> : null}
      {children}
    </span>
  );
}

/** 「未实现」 tag; the hint is shown as a tooltip and also read by screen readers. */
export function TodoTag({ hint }: { hint: string }) {
  return (
    <span className="tag is-todo" title={hint}>
      未实现<span className="sr-only">：{hint}</span>
    </span>
  );
}

/** 「仅 macOS」 tag. */
export function MacTag() {
  return <span className="tag">仅 macOS</span>;
}

/** Colour dot + value in mono (palette list). */
export function Swatch({ color }: { color: string }) {
  return (
    <span className="swatch" style={{ "--c": color } as CSSProperties}>
      <i aria-hidden="true" />
      {color}
    </span>
  );
}
