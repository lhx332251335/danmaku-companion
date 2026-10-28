import type { ReactNode } from "react";

export interface EmptyStateProps {
  /** Icon element, e.g. <ScrollText />. */
  icon?: ReactNode;
  title: ReactNode;
  /** One or two short sentences. */
  children?: ReactNode;
  /** A button or link. */
  action?: ReactNode;
  /** Smaller padding for use inside a card. */
  compact?: boolean;
  className?: string;
}

/** Dashed box with a muted icon, e.g. 还没有生成记录. */
export function EmptyState({ icon, title, children, action, compact = false, className }: EmptyStateProps) {
  return (
    <div className={["empty", compact ? "is-compact" : "", className].filter(Boolean).join(" ")}>
      {icon ? (
        <span className="decor" aria-hidden="true">
          <span className="empty-ico">{icon}</span>
        </span>
      ) : null}
      <div className="empty-title">{title}</div>
      {children ? <div className="empty-desc">{children}</div> : null}
      {action}
    </div>
  );
}
