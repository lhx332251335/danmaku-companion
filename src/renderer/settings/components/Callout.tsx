import { CircleAlert, CircleCheck, Info, Sparkles, TriangleAlert, X } from "lucide-react";
import type { ReactNode } from "react";

export type CalloutTone = "neutral" | "info" | "ok" | "warn" | "bad" | "violet";

const defaultIcons: Record<CalloutTone, ReactNode> = {
  neutral: <Info />,
  info: <Info />,
  ok: <CircleCheck />,
  warn: <TriangleAlert />,
  bad: <CircleAlert />,
  violet: <Sparkles />,
};

export interface CalloutProps {
  /** info = accent tint (explanations), warn = caution, bad = critical, ok, violet (summary). */
  tone?: CalloutTone;
  /** Bold lead-in before the text, e.g. 上一轮失败：. */
  title?: ReactNode;
  /** Icon element; false hides it. Defaults to one per tone. */
  icon?: ReactNode | false;
  /** Buttons or links on the right (e.g. <LinkButton>查看日志</LinkButton>). */
  action?: ReactNode;
  /** Shows a × button that calls this. */
  onDismiss?: () => void;
  dismissLabel?: string;
  /** Page-level banner (slightly larger, used above the page content). */
  banner?: boolean;
  /**
   * "alert" for errors that need attention now, "status" for results (connection test),
   * "note" for explanations (default for non-errors).
   */
  role?: "alert" | "status" | "note";
  className?: string;
  children?: ReactNode;
}

/** Tinted message box with an icon; also the page banner. */
export function Callout({
  tone = "neutral",
  title,
  icon,
  action,
  onDismiss,
  dismissLabel = "关闭",
  banner = false,
  role,
  className,
  children,
}: CalloutProps) {
  const shownIcon = icon === false ? null : (icon ?? defaultIcons[tone]);

  return (
    <div
      role={role ?? (tone === "bad" ? "alert" : "note")}
      className={["callout", `tone-${tone}`, banner ? "is-banner" : "", className]
        .filter(Boolean)
        .join(" ")}
    >
      {shownIcon ? (
        <span className="decor callout-ico-wrap" aria-hidden="true">
          <span className="callout-ico">{shownIcon}</span>
        </span>
      ) : null}
      <div className="callout-body">
        {title ? <span className="callout-title">{title}</span> : null}
        {children}
      </div>
      {action ? <div className="callout-action">{action}</div> : null}
      {onDismiss ? (
        <button
          type="button"
          className="callout-close"
          aria-label={dismissLabel}
          title={dismissLabel}
          onClick={onDismiss}
        >
          <X aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}
