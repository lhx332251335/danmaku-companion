import { Minus, Plus } from "lucide-react";
import { useId, useState, type CSSProperties, type FocusEvent, type KeyboardEvent } from "react";
import type { NumericRange } from "../../../shared/limits";
import { displayNumber, parseScaledInput, roundForDisplay } from "../format";
import { useControlA11y, useFieldContext, type ControlA11yProps } from "./Field";

/** Approximate width of a unit suffix in em (CJK glyphs are 1em, Latin about 0.6em). */
function unitWidthEm(unit: string): number {
  let width = 0;
  for (const char of unit) {
    width += char.charCodeAt(0) > 0x2e80 ? 1 : 0.62;
  }
  return Math.max(1, width);
}

export function unitStyle(unit: string | undefined): CSSProperties | undefined {
  return unit ? ({ "--unit-w": `${unitWidthEm(unit)}em` } as CSSProperties) : undefined;
}

interface NumberTextOptions {
  value: number;
  range: NumericRange;
  integer: boolean;
  scale: number;
  onCommit: (value: number) => void;
}

/**
 * The old NumberField behaviour: keeps the typed text while editing; only finite, clamped
 * numbers reach the draft. Blur or Enter shows the committed value again.
 */
function useNumberText({ value, range, integer, scale, onCommit }: NumberTextOptions) {
  const [text, setText] = useState<string | null>(null);

  return {
    text: text ?? displayNumber(value, scale),
    onChange(raw: string) {
      setText(raw);
      const parsed = parseScaledInput(raw, range, integer, scale);
      if (parsed !== undefined && parsed !== value) {
        onCommit(parsed);
      }
    },
    onBlur() {
      setText(null);
    },
    /** Show the stored value again, e.g. after a step changed it. */
    reset() {
      setText(null);
    },
    onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
      if (event.key === "Enter") {
        setText(null);
      }
    },
  };
}

export interface NumberFieldProps extends ControlA11yProps {
  /** Stored value. */
  value: number;
  /** Allowed range in stored units, normally from LIMITS. */
  range: NumericRange;
  /** Receives every parsed, clamped value (stored units) while typing. */
  onCommit: (value: number) => void;
  /** Step of the input in displayed units (default 1). */
  step?: number;
  /** Round the stored value to an integer. */
  integer?: boolean;
  /** Displayed = stored × scale: 100 shows 0.2–1 as 20–100, 0.001 shows ms as seconds. */
  scale?: number;
  /** Unit suffix inside the field: px, 秒, MB, 张, 轮, 条, 字, tokens, %. */
  unit?: string;
  disabled?: boolean;
  className?: string;
}

/** Number input with a unit suffix. Takes id/label/description from a surrounding Field. */
export function NumberField({
  value,
  range,
  onCommit,
  step = 1,
  integer = false,
  scale = 1,
  unit,
  disabled,
  className,
  ...a11y
}: NumberFieldProps) {
  const field = useFieldContext();
  const ids = useControlA11y(a11y);
  const number = useNumberText({ value, range, integer, scale, onCommit });

  return (
    <div
      className={["affix", unit ? "has-unit" : "", className].filter(Boolean).join(" ")}
      style={unitStyle(unit)}
    >
      <input
        {...ids}
        type="number"
        inputMode={integer && scale === 1 ? "numeric" : "decimal"}
        className="input number-input num"
        min={roundForDisplay(range.min * scale)}
        max={roundForDisplay(range.max * scale)}
        step={step}
        value={number.text}
        disabled={disabled ?? field?.disabled}
        onChange={(event) => number.onChange(event.target.value)}
        onBlur={number.onBlur}
        onKeyDown={number.onKeyDown}
      />
      {unit ? (
        <span className="unit" aria-hidden="true">
          {unit}
        </span>
      ) : null}
    </div>
  );
}

export interface RangePairProps {
  min: number;
  max: number;
  /** Range for both ends (stored units). */
  range: NumericRange;
  /** Receives both ends whenever either changes; swapped into order when focus leaves. */
  onCommit: (next: { min: number; max: number }) => void;
  step?: number;
  integer?: boolean;
  scale?: number;
  unit?: string;
  disabled?: boolean;
  /** Names of the two inputs; screen readers hear "<Field label> 最短". */
  minLabel?: string;
  maxLabel?: string;
  /** Group name when there is no surrounding <Field group>. */
  "aria-label"?: string;
}

/**
 * Two NumberFields joined by an en dash ("14 – 28 秒"). Use inside <Field group>. When the
 * minimum ends up above the maximum it says so, and swaps them when focus leaves the pair
 * (the runtime orders them the same way).
 */
export function RangePair({
  min,
  max,
  range,
  onCommit,
  step = 1,
  integer = false,
  scale = 1,
  unit,
  disabled,
  minLabel = "最短",
  maxLabel = "最长",
  "aria-label": ariaLabel,
}: RangePairProps) {
  const field = useFieldContext();
  const autoId = useId();
  const base = field?.controlId ?? `rp${autoId.replace(/:/g, "")}`;
  const inverted = min > max;
  const orderId = `${base}-order`;
  // NumberField adds the Field's own help id; only the order warning is extra.
  const describedBy = inverted ? orderId : undefined;

  function nameProps(end: "min" | "max") {
    const text = end === "min" ? minLabel : maxLabel;
    return field && !ariaLabel
      ? { "aria-labelledby": `${field.labelId} ${base}-${end}-name` }
      : { "aria-label": ariaLabel ? `${ariaLabel} ${text}` : text };
  }

  function handleBlur(event: FocusEvent<HTMLDivElement>) {
    const next = event.relatedTarget as Node | null;
    if (next && event.currentTarget.contains(next)) return;
    if (min > max) {
      onCommit({ min: max, max: min });
    }
  }

  return (
    <div className="range-pair-wrap">
      <div
        className="range-pair"
        role="group"
        aria-label={ariaLabel}
        aria-labelledby={ariaLabel ? undefined : field?.labelId}
        onBlur={handleBlur}
      >
        <span className="sr-only" id={`${base}-min-name`}>
          {minLabel}
        </span>
        <span className="sr-only" id={`${base}-max-name`}>
          {maxLabel}
        </span>
        <NumberField
          id={base}
          {...nameProps("min")}
          aria-describedby={describedBy}
          value={min}
          range={range}
          step={step}
          integer={integer}
          scale={scale}
          unit={unit}
          disabled={disabled}
          onCommit={(value) => onCommit({ min: value, max })}
        />
        <span className="dash" aria-hidden="true">
          –
        </span>
        <NumberField
          id={`${base}-max`}
          {...nameProps("max")}
          aria-describedby={describedBy}
          value={max}
          range={range}
          step={step}
          integer={integer}
          scale={scale}
          unit={unit}
          disabled={disabled}
          onCommit={(value) => onCommit({ min, max: value })}
        />
      </div>
      {inverted ? (
        <p className="help is-error" id={orderId}>
          最短值大于最长值，离开输入框后会自动互换
        </p>
      ) : null}
    </div>
  );
}

export interface StepperProps extends ControlA11yProps {
  value: number;
  range: NumericRange;
  onCommit: (value: number) => void;
  step?: number;
  /** Shown after the stepper and read with the value ("3 条"). */
  unit?: string;
  disabled?: boolean;
  decrementLabel?: string;
  incrementLabel?: string;
}

/** − [value] + for small integers (每轮弹幕 1–12). Buttons disable at the range ends. */
export function Stepper({
  value,
  range,
  onCommit,
  step = 1,
  unit,
  disabled,
  decrementLabel = "减少",
  incrementLabel = "增加",
  ...a11y
}: StepperProps) {
  const field = useFieldContext();
  const ids = useControlA11y(a11y);
  const number = useNumberText({ value, range, integer: true, scale: 1, onCommit });
  const isDisabled = disabled ?? field?.disabled ?? false;

  function stepBy(delta: number) {
    number.reset();
    const next = Math.min(range.max, Math.max(range.min, Math.round(value + delta)));
    if (next !== value) onCommit(next);
  }

  return (
    <div className="stepper-wrap">
      <div className="stepper">
        <button
          type="button"
          aria-label={decrementLabel}
          title={decrementLabel}
          disabled={isDisabled || value <= range.min}
          onClick={() => stepBy(-step)}
        >
          <Minus aria-hidden="true" />
        </button>
        <input
          {...ids}
          type="text"
          inputMode="numeric"
          role="spinbutton"
          aria-valuemin={range.min}
          aria-valuemax={range.max}
          aria-valuenow={value}
          aria-valuetext={unit ? `${value} ${unit}` : undefined}
          className="num"
          value={number.text}
          disabled={isDisabled}
          onChange={(event) => number.onChange(event.target.value)}
          onBlur={number.onBlur}
          onKeyDown={(event) => {
            if (event.key === "ArrowUp") {
              event.preventDefault();
              stepBy(step);
            } else if (event.key === "ArrowDown") {
              event.preventDefault();
              stepBy(-step);
            } else {
              number.onKeyDown(event);
            }
          }}
        />
        <button
          type="button"
          aria-label={incrementLabel}
          title={incrementLabel}
          disabled={isDisabled || value >= range.max}
          onClick={() => stepBy(step)}
        >
          <Plus aria-hidden="true" />
        </button>
      </div>
      {unit ? (
        <span className="stepper-unit" aria-hidden="true">
          {unit}
        </span>
      ) : null}
    </div>
  );
}
