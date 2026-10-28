import type { ReactNode } from "react";

/**
 * Hides decorative content (icons passed as props) from screen readers without affecting
 * layout: the wrapper is `display: contents`.
 */
export function Decor({ children }: { children: ReactNode }) {
  return (
    <span className="decor" aria-hidden="true">
      {children}
    </span>
  );
}
