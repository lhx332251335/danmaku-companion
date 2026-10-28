import { useId, type ReactNode } from "react";

export interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Visible title (13.5 px / 600); also the accessible name. */
  label: ReactNode;
  /** Short visible description under the title; linked with aria-describedby. */
  description?: ReactNode;
  /** Shown after the title, e.g. <TodoTag hint="…" />. */
  tag?: ReactNode;
  disabled?: boolean;
  /** Keep the label for screen readers only (a bare switch inside a custom row). */
  hideLabel?: boolean;
  id?: string;
  className?: string;
}

/**
 * Switch row: a real checkbox with role="switch" (40×22) on the left and the title and
 * description on the right. The whole row toggles it.
 */
export function Switch({
  checked,
  onChange,
  label,
  description,
  tag,
  disabled = false,
  hideLabel = false,
  id,
  className,
}: SwitchProps) {
  const autoId = useId();
  const base = id ?? `sw${autoId.replace(/:/g, "")}`;
  const titleId = `${base}-title`;
  const descriptionId = description ? `${base}-desc` : undefined;

  return (
    <label
      className={["switch-row", disabled ? "is-disabled" : "", className].filter(Boolean).join(" ")}
    >
      <input
        id={id}
        type="checkbox"
        role="switch"
        className="switch"
        checked={checked}
        disabled={disabled}
        aria-checked={checked}
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className={hideLabel ? "sr-only" : "switch-text"}>
        <span className="switch-title" id={titleId}>
          {label}
          {tag}
        </span>
        {description ? (
          <span className="switch-desc" id={descriptionId}>
            {description}
          </span>
        ) : null}
      </span>
    </label>
  );
}
