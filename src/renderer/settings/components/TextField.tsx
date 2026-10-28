import { Eye, EyeOff } from "lucide-react";
import {
  useState,
  type InputHTMLAttributes,
  type ReactNode,
  type Ref,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { useControlA11y, useFieldContext } from "./Field";
import { countText } from "../format";
import { unitStyle } from "./NumberField";

export interface TextFieldProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type" | "prefix"> {
  value: string;
  onChange: (value: string) => void;
  /** "password" adds a show/hide button. */
  type?: "text" | "password" | "url" | "search";
  /** Leading icon element, e.g. <Link />. */
  icon?: ReactNode;
  /** Monospace text (URLs, keys, colour lists). */
  mono?: boolean;
  /** Unit suffix inside the field. */
  unit?: string;
  /** Names of the reveal button for password fields. */
  revealLabels?: { show: string; hide: string };
  inputRef?: Ref<HTMLInputElement>;
}

/** 36 px text input; takes id/label/description from a surrounding Field. */
export function TextField({
  value,
  onChange,
  type = "text",
  icon,
  mono = false,
  unit,
  revealLabels = { show: "显示密钥", hide: "隐藏密钥" },
  inputRef,
  className,
  disabled,
  id,
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledBy,
  "aria-describedby": ariaDescribedBy,
  ...rest
}: TextFieldProps) {
  const field = useFieldContext();
  const ids = useControlA11y({
    id,
    "aria-label": ariaLabel,
    "aria-labelledby": ariaLabelledBy,
    "aria-describedby": ariaDescribedBy,
  });
  const [revealed, setRevealed] = useState(false);
  const isPassword = type === "password";
  const classes = [
    "affix",
    icon ? "has-pre" : "",
    unit ? "has-unit" : "",
    isPassword ? "has-btn" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={classes} style={unitStyle(unit)}>
      {icon ? (
        <span className="pre" aria-hidden="true">
          {icon}
        </span>
      ) : null}
      <input
        {...rest}
        {...ids}
        ref={inputRef}
        type={isPassword && revealed ? "text" : type}
        className={["input", mono ? "mono" : ""].filter(Boolean).join(" ")}
        value={value}
        disabled={disabled ?? field?.disabled}
        spellCheck={isPassword || mono ? false : rest.spellCheck}
        autoComplete={isPassword ? "off" : rest.autoComplete}
        onChange={(event) => onChange(event.target.value)}
      />
      {unit ? (
        <span className="unit" aria-hidden="true">
          {unit}
        </span>
      ) : null}
      {isPassword ? (
        <button
          type="button"
          className="in-btn"
          aria-label={revealed ? revealLabels.hide : revealLabels.show}
          aria-pressed={revealed}
          title={revealed ? revealLabels.hide : revealLabels.show}
          disabled={disabled ?? field?.disabled}
          onClick={() => setRevealed((current) => !current)}
        >
          {revealed ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
        </button>
      ) : null}
    </div>
  );
}

export interface TextAreaProps
  extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "value" | "onChange"> {
  value: string;
  onChange: (value: string) => void;
  mono?: boolean;
  /** Shows "N 字 · M 行" under the field. */
  showCount?: boolean;
  textareaRef?: Ref<HTMLTextAreaElement>;
}

/** Multi-line input; `mono` for templates. */
export function TextArea({
  value,
  onChange,
  mono = false,
  showCount = false,
  textareaRef,
  className,
  disabled,
  id,
  rows = 4,
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledBy,
  "aria-describedby": ariaDescribedBy,
  ...rest
}: TextAreaProps) {
  const field = useFieldContext();
  const ids = useControlA11y({
    id,
    "aria-label": ariaLabel,
    "aria-labelledby": ariaLabelledBy,
    "aria-describedby": ariaDescribedBy,
  });
  const textarea = (
    <textarea
      {...rest}
      {...ids}
      ref={textareaRef}
      rows={rows}
      className={["input", mono ? "mono" : "", className].filter(Boolean).join(" ")}
      value={value}
      disabled={disabled ?? field?.disabled}
      spellCheck={mono ? false : rest.spellCheck}
      onChange={(event) => onChange(event.target.value)}
    />
  );

  if (!showCount) {
    return textarea;
  }

  return (
    <div className="textarea-wrap">
      {textarea}
      <span className="textarea-count num">{countText(value)}</span>
    </div>
  );
}

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps
  extends Omit<SelectHTMLAttributes<HTMLSelectElement>, "value" | "onChange"> {
  value: string;
  onChange: (value: string) => void;
  /** Options; or pass <option> children. */
  options?: SelectOption[];
  /** Adds a first option with value "" (e.g. 从 3 个模型中选择…). */
  placeholder?: string;
  mono?: boolean;
}

/** Native select with the field look. */
export function Select({
  value,
  onChange,
  options,
  placeholder,
  mono = false,
  className,
  disabled,
  children,
  id,
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledBy,
  "aria-describedby": ariaDescribedBy,
  ...rest
}: SelectProps) {
  const field = useFieldContext();
  const ids = useControlA11y({
    id,
    "aria-label": ariaLabel,
    "aria-labelledby": ariaLabelledBy,
    "aria-describedby": ariaDescribedBy,
  });

  return (
    <select
      {...rest}
      {...ids}
      className={["input", mono ? "mono" : "", className].filter(Boolean).join(" ")}
      value={value}
      disabled={disabled ?? field?.disabled}
      onChange={(event) => onChange(event.target.value)}
    >
      {placeholder !== undefined ? <option value="">{placeholder}</option> : null}
      {options?.map((option) => (
        <option key={option.value} value={option.value} disabled={option.disabled}>
          {option.label}
        </option>
      ))}
      {children}
    </select>
  );
}
