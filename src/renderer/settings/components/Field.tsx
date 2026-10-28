import { CircleAlert } from "lucide-react";
import { createContext, useContext, useId, type ReactNode } from "react";

interface FieldContextValue {
  /** id for the control the visible label points at. */
  controlId: string;
  /** id of the label element, for controls that need aria-labelledby (groups, second inputs). */
  labelId: string;
  /** id of the help or error text. */
  describedBy?: string;
  invalid: boolean;
  disabled: boolean;
}

const FieldContext = createContext<FieldContextValue | null>(null);

/** The surrounding Field, if any (controls take their id, label and description from it). */
export function useFieldContext(): FieldContextValue | null {
  return useContext(FieldContext);
}

export interface ControlA11yProps {
  id?: string;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  "aria-describedby"?: string;
}

/** Merges explicit a11y props with the ones the surrounding Field provides. */
export function useControlA11y(props: ControlA11yProps, useLabelledBy = false) {
  const field = useFieldContext();
  const describedBy =
    [props["aria-describedby"], field?.describedBy].filter(Boolean).join(" ") || undefined;
  return {
    id: props.id ?? (useLabelledBy ? undefined : field?.controlId),
    "aria-label": props["aria-label"],
    "aria-labelledby":
      props["aria-labelledby"] ?? (useLabelledBy && !props["aria-label"] ? field?.labelId : undefined),
    "aria-describedby": describedBy,
    "aria-invalid": field?.invalid ? (true as const) : undefined,
  };
}

export interface FieldProps {
  /** Visible label (13 px / 600). */
  label: ReactNode;
  /** Right-aligned quiet text on the label row: a range ("10 – 96 px") or a unit. */
  hint?: ReactNode;
  /** Short visible description under the control. */
  help?: ReactNode;
  /** Error text; replaces the help, turns red and marks the control aria-invalid. */
  error?: ReactNode;
  /** Shown right after the label text, e.g. <TodoTag />. */
  tag?: ReactNode;
  /**
   * The child is a group (RangePair, Segmented, RadioCards): the label becomes a plain text
   * element that the group references with aria-labelledby instead of a <label for>.
   */
  group?: boolean;
  /** Dims the label; disable the control itself too. */
  disabled?: boolean;
  /** id for the control (default: generated). */
  id?: string;
  className?: string;
  children: ReactNode;
}

/** Label + hint row, the control, and a help or error line, wired up for screen readers. */
export function Field({
  label,
  hint,
  help,
  error,
  tag,
  group = false,
  disabled = false,
  id,
  className,
  children,
}: FieldProps) {
  const autoId = useId();
  const controlId = id ?? `f${autoId.replace(/:/g, "")}`;
  const labelId = `${controlId}-label`;
  const messageId = `${controlId}-help`;
  const hasMessage = Boolean(error || help);

  const context: FieldContextValue = {
    controlId,
    labelId,
    describedBy: hasMessage ? messageId : undefined,
    invalid: Boolean(error),
    disabled,
  };

  return (
    <div className={["field", disabled ? "is-disabled" : "", className].filter(Boolean).join(" ")}>
      <div className="field-label">
        {group ? (
          <span id={labelId}>{label}</span>
        ) : (
          <label id={labelId} htmlFor={controlId}>
            {label}
          </label>
        )}
        {tag}
        {hint ? <span className="hint">{hint}</span> : null}
      </div>
      <FieldContext.Provider value={context}>{children}</FieldContext.Provider>
      {error ? (
        <p className="help is-error" id={messageId}>
          <CircleAlert className="ico-xs" aria-hidden="true" />
          <span>{error}</span>
        </p>
      ) : help ? (
        <p className="help" id={messageId}>
          {help}
        </p>
      ) : null}
    </div>
  );
}
