import { useState } from "react";
import { useControlA11y, useFieldContext, type ControlA11yProps } from "./Field";

export interface ListFieldProps extends ControlA11yProps {
  values: string[];
  /** Turns the raw text into values; undefined keeps the last valid list (e.g. parsePalette). */
  parse: (raw: string) => string[] | undefined;
  onCommit: (values: string[]) => void;
  placeholder?: string;
  disabled?: boolean;
  mono?: boolean;
  title?: string;
  /**
   * Called with the raw text while the user types, and with null when the field shows the
   * committed list again (on blur). Lets a page flag entries that `parse` dropped.
   */
  onTextChange?: (raw: string | null) => void;
}

/**
 * Comma-separated list input that keeps the raw text (including a trailing comma) while
 * focused; shows the committed list again on blur.
 */
export function ListField({
  values,
  parse,
  onCommit,
  placeholder,
  disabled,
  mono = false,
  title,
  onTextChange,
  ...a11y
}: ListFieldProps) {
  const field = useFieldContext();
  const ids = useControlA11y(a11y);
  const [text, setText] = useState<string | null>(null);

  function handleChange(raw: string) {
    setText(raw);
    onTextChange?.(raw);
    const parsed = parse(raw);
    if (parsed && parsed.join("\n") !== values.join("\n")) {
      onCommit(parsed);
    }
  }

  return (
    <input
      {...ids}
      className={["input", mono ? "mono" : ""].filter(Boolean).join(" ")}
      value={text ?? values.join(", ")}
      placeholder={placeholder}
      disabled={disabled ?? field?.disabled}
      title={title}
      spellCheck={false}
      onChange={(event) => handleChange(event.target.value)}
      onBlur={() => {
        setText(null);
        onTextChange?.(null);
      }}
    />
  );
}
