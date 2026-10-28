import { useId, type ReactNode } from "react";
import type { Tone } from "../format";

export type IconTone = Exclude<Tone, "neutral"> | "neutral";

export interface TileIconProps {
  /** Icon element, e.g. <Cpu />. */
  icon: ReactNode;
  tone?: IconTone;
  size?: "md" | "sm";
}

/** Rounded tinted square holding an icon (28 px, 24 px small). Decorative. */
export function TileIcon({ icon, tone = "accent", size = "md" }: TileIconProps) {
  return (
    <span
      className={["tile-ico", tone !== "accent" ? `tone-${tone}` : "", size === "sm" ? "is-sm" : ""]
        .filter(Boolean)
        .join(" ")}
      aria-hidden="true"
    >
      {icon}
    </span>
  );
}

export interface CardProps {
  /** Card title (15 px / 650); also the section's accessible name. */
  title?: ReactNode;
  /** Icon element for the tinted icon chip before the title. */
  icon?: ReactNode;
  iconTone?: IconTone;
  /** Quiet line under the title. */
  sub?: ReactNode;
  /** Right side of the head: chips or small actions. */
  aside?: ReactNode;
  /** Footer row with a top border. */
  footer?: ReactNode;
  /** Heading level of the title (default 2). */
  level?: 2 | 3;
  /** Render the children without the padded body grid (tabs, editors, stages). */
  bare?: boolean;
  id?: string;
  className?: string;
  bodyClassName?: string;
  children?: ReactNode;
}

/** 16 px radius surface with an optional icon + title head, a body grid (gap 16) and a footer. */
export function Card({
  title,
  icon,
  iconTone = "accent",
  sub,
  aside,
  footer,
  level = 2,
  bare = false,
  id,
  className,
  bodyClassName,
  children,
}: CardProps) {
  const autoId = useId();
  const titleId = title ? `${id ?? `card${autoId.replace(/:/g, "")}`}-title` : undefined;
  const Heading = level === 3 ? "h3" : "h2";

  return (
    <section
      id={id}
      className={["card", className].filter(Boolean).join(" ")}
      aria-labelledby={titleId}
    >
      {title || aside ? (
        <div className="card-head">
          {icon ? <TileIcon icon={icon} tone={iconTone} /> : null}
          <div className="card-titles">
            {title ? <Heading id={titleId}>{title}</Heading> : null}
            {sub ? <div className="sub">{sub}</div> : null}
          </div>
          {aside ? <div className="card-aside">{aside}</div> : null}
        </div>
      ) : null}
      {children !== undefined && children !== null ? (
        bare ? (
          children
        ) : (
          <div className={["card-body", bodyClassName].filter(Boolean).join(" ")}>{children}</div>
        )
      ) : null}
      {footer ? <div className="card-foot">{footer}</div> : null}
    </section>
  );
}
