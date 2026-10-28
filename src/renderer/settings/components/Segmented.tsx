import { useId, type ReactNode } from "react";
import { useFieldContext } from "./Field";

export interface SegmentedOption<T extends string> {
  value: T;
  label: ReactNode;
  /** Leading icon element (e.g. <Moon />, or <ZoneIcon zone="top" />). */
  icon?: ReactNode;
  /** Small count after the label (log filters). */
  count?: ReactNode;
  disabled?: boolean;
  title?: string;
}

export interface SegmentedProps<T extends string> {
  value: T;
  onChange: (value: T) => void;
  options: readonly SegmentedOption<T>[];
  /** Radio group name (default: generated). */
  name?: string;
  /** Stretch to the container and share the width equally. */
  full?: boolean;
  size?: "md" | "sm";
  disabled?: boolean;
  /** Group name, unless a surrounding <Field group> labels it. */
  "aria-label"?: string;
  "aria-labelledby"?: string;
  className?: string;
}

/**
 * Segmented control built from real radio inputs, so arrow keys move the selection and
 * forms/screen readers see a radiogroup.
 */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  name,
  full = false,
  size = "md",
  disabled = false,
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledBy,
  className,
}: SegmentedProps<T>) {
  const field = useFieldContext();
  const autoId = useId();
  const groupName = name ?? `seg${autoId.replace(/:/g, "")}`;

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy ?? (ariaLabel ? undefined : field?.labelId)}
      aria-describedby={field?.describedBy}
      className={["seg", full ? "is-full" : "", size === "sm" ? "is-sm" : "", className]
        .filter(Boolean)
        .join(" ")}
    >
      {options.map((option) => (
        <label key={option.value} title={option.title}>
          <input
            type="radio"
            name={groupName}
            value={option.value}
            checked={option.value === value}
            disabled={disabled || option.disabled || field?.disabled}
            onChange={() => onChange(option.value)}
          />
          {option.icon ? (
            <span className="decor" aria-hidden="true">
              {option.icon}
            </span>
          ) : null}
          <span>{option.label}</span>
          {option.count !== undefined ? <span className="seg-count num">{option.count}</span> : null}
        </label>
      ))}
    </div>
  );
}

/** The mini screen-band icon of the display-zone options. */
export function ZoneIcon({ zone }: { zone: "full" | "top" | "middle" | "bottom" }) {
  return <span className={`zone-ico ${zone}`} aria-hidden="true" />;
}

export interface RadioCardOption<T extends string> {
  value: T;
  title: ReactNode;
  /** One-line explanation under the title (linked with aria-describedby). */
  description?: ReactNode;
  /** Status chip next to the title, e.g. <Chip tone="ok">缓存友好</Chip>. */
  chip?: ReactNode;
  /** Small illustration on the right (decorative). */
  illustration?: ReactNode;
  disabled?: boolean;
}

export interface RadioCardsProps<T extends string> {
  value: T;
  onChange: (value: T) => void;
  options: readonly RadioCardOption<T>[];
  name?: string;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  className?: string;
}

/** A radio group of cards with title, chip, description and an optional illustration. */
export function RadioCards<T extends string>({
  value,
  onChange,
  options,
  name,
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledBy,
  className,
}: RadioCardsProps<T>) {
  const field = useFieldContext();
  const autoId = useId();
  const base = name ?? `rc${autoId.replace(/:/g, "")}`;

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy ?? (ariaLabel ? undefined : field?.labelId)}
      aria-describedby={field?.describedBy}
      className={["radio-cards", className].filter(Boolean).join(" ")}
    >
      {options.map((option) => {
        const descriptionId = option.description ? `${base}-${option.value}-desc` : undefined;
        return (
          <label key={option.value} className="radio-card">
            <input
              type="radio"
              name={base}
              value={option.value}
              checked={option.value === value}
              disabled={option.disabled || field?.disabled}
              aria-describedby={descriptionId}
              onChange={() => onChange(option.value)}
            />
            <span className="radio-dot" aria-hidden="true" />
            <span className="radio-title">
              {option.title}
              {option.chip}
            </span>
            {option.description ? (
              <span className="radio-desc" id={descriptionId}>
                {option.description}
              </span>
            ) : null}
            {option.illustration ? (
              <span className="radio-art" aria-hidden="true">
                {option.illustration}
              </span>
            ) : null}
          </label>
        );
      })}
    </div>
  );
}
