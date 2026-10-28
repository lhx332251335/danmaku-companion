import { LoaderCircle } from "lucide-react";
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Decor } from "./Decor";

export type ButtonVariant = "standard" | "primary" | "subtle" | "danger" | "dock";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: "md" | "sm";
  /** Leading icon element, e.g. <Save />. Replaced by a spinner while busy. */
  icon?: ReactNode;
  /**
   * Icon-only button: children are not rendered; `label` becomes the aria-label and the
   * tooltip. Pass `label` for every icon-only button.
   */
  iconOnly?: boolean;
  /** Accessible name (and title) for icon-only buttons. */
  label?: string;
  /** Shows a spinner, disables the button and sets aria-busy. */
  busy?: boolean;
  /** Text shown instead of the children while busy, e.g. 保存中. */
  busyLabel?: ReactNode;
  /** Stretches to the container width. */
  block?: boolean;
}

/** 36 px (32 px small) button; type defaults to "button". */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = "standard",
    size = "md",
    icon,
    iconOnly = false,
    label,
    busy = false,
    busyLabel,
    block = false,
    className,
    children,
    disabled,
    type = "button",
    title,
    ...rest
  },
  ref,
) {
  const classes = [
    "btn",
    variant !== "standard" ? `btn-${variant}` : "",
    size === "sm" ? "btn-sm" : "",
    iconOnly ? "btn-icon" : "",
    block ? "btn-block" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");
  const shownIcon = busy ? <LoaderCircle className="spin" aria-hidden="true" /> : icon;

  return (
    <button
      ref={ref}
      type={type}
      className={classes}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      aria-label={iconOnly ? label : rest["aria-label"]}
      title={title ?? (iconOnly ? label : undefined)}
      {...rest}
    >
      {shownIcon ? <Decor>{shownIcon}</Decor> : null}
      {iconOnly ? null : busy && busyLabel ? busyLabel : children}
    </button>
  );
});

export interface LinkButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Trailing icon, e.g. <ArrowRight />. */
  icon?: ReactNode;
}

/** Underlined text action such as 查看日志 →; for in-app navigation use an <a href="#logs">. */
export function LinkButton({ icon, className, children, type = "button", ...rest }: LinkButtonProps) {
  return (
    <button type={type} className={["link-btn", className].filter(Boolean).join(" ")} {...rest}>
      {children}
      {icon ? <Decor>{icon}</Decor> : null}
    </button>
  );
}
