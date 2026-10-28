import type { CSSProperties } from "react";
import type { NumericRange } from "../../../shared/limits";
import { roundForDisplay } from "../format";
import { useControlA11y, useFieldContext, type ControlA11yProps } from "./Field";
import { NumberField } from "./NumberField";

export interface SliderFieldProps extends ControlA11yProps {
  /** Stored value. */
  value: number;
  /** Range in stored units (LIMITS.*). */
  range: NumericRange;
  onCommit: (value: number) => void;
  /** Slider step in stored units (0.01 for opacity, 1 for px). */
  step: number;
  /** Displayed = stored × scale, for the number box and the spoken value (100 → %). */
  scale?: number;
  /** Unit suffix of the number box and the spoken value. */
  unit?: string;
  integer?: boolean;
  disabled?: boolean;
  /** Step of the number box in displayed units (default step × scale). */
  numberStep?: number;
  /** Width of the number box (default 96 px). */
  numberWidth?: number;
}

/**
 * Range slider plus a NumberField bound to the same value. The slider gets the Field's id;
 * the number box is labelled by the same Field label.
 */
export function SliderField({
  value,
  range,
  onCommit,
  step,
  scale = 1,
  unit,
  integer = false,
  disabled,
  numberStep,
  numberWidth,
  ...a11y
}: SliderFieldProps) {
  const field = useFieldContext();
  const sliderIds = useControlA11y(a11y);
  const isDisabled = disabled ?? field?.disabled ?? false;
  const span = range.max - range.min;
  const percent = span > 0 ? ((Math.min(range.max, Math.max(range.min, value)) - range.min) / span) * 100 : 0;
  const shown = roundForDisplay(value * scale);
  const spoken = unit ? (unit === "%" ? `${shown}%` : `${shown} ${unit}`) : String(shown);
  const style = {
    ...(numberWidth ? { "--num-w": `${numberWidth}px` } : {}),
  } as CSSProperties;

  return (
    <div className="slider-field" style={style}>
      <input
        {...sliderIds}
        type="range"
        className="slider"
        min={range.min}
        max={range.max}
        step={step}
        value={value}
        disabled={isDisabled}
        aria-valuetext={spoken}
        style={{ "--p": `${percent}%` } as CSSProperties}
        onChange={(event) => {
          const next = Number(event.target.value);
          if (Number.isFinite(next)) {
            onCommit(integer ? Math.round(next) : roundForDisplay(next));
          }
        }}
      />
      <NumberField
        id={sliderIds.id ? `${sliderIds.id}-num` : undefined}
        aria-label={a11y["aria-label"]}
        aria-labelledby={a11y["aria-labelledby"] ?? (a11y["aria-label"] ? undefined : field?.labelId)}
        aria-describedby={a11y["aria-describedby"]}
        value={value}
        range={range}
        step={numberStep ?? roundForDisplay(step * scale)}
        integer={integer}
        scale={scale}
        unit={unit}
        disabled={isDisabled}
        onCommit={onCommit}
      />
    </div>
  );
}
