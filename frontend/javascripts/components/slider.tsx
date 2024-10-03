import { Slider as AntdSlider, type SliderSingleProps } from "antd";
import type { SliderRangeProps } from "antd/lib/slider";
import { clamp } from "libs/utils";
import type { WheelEventHandler } from "react";

const DEFAULT_WHEEL_FACTOR = 0.02;
const DEFAULT_STEP = 1;

type SliderProps = (SliderSingleProps | SliderRangeProps) & {
  wheelFactor?: number;
  onWheelDisabled?: boolean;
};

const getDiffPerSliderStep = (
  sliderRange: number,
  factor: number = DEFAULT_WHEEL_FACTOR,
  step: number | undefined | null,
) => {
  let stepNotNull = step || DEFAULT_STEP;
  let result = factor * sliderRange;
  if (result < stepNotNull) return stepNotNull;
  return result;
};

const getWheelStepFromEvent = (
  step: number | undefined | null,
  deltaY: number,
  wheelStep: number,
) => {
  // Make sure that result is a multiple of step
  return (
    (step || DEFAULT_STEP) *
    Math.round((wheelStep * deltaY) / Math.abs(deltaY) / (step || DEFAULT_STEP))
  );
};

export function Slider(props: SliderProps) {
  const {
    min,
    max,
    onChange,
    value,
    range,
    defaultValue,
    wheelFactor,
    onWheelDisabled: disableOnWheel,
    step,
    disabled,
  } = props;
  if (min == null || max == null || onChange == null || value == null || disabled)
    return <AntdSlider {...props} />;
  const sliderRange = max - min;
  let handleWheelEvent: WheelEventHandler<HTMLDivElement> = () => {};
  let handleDoubleClick: React.MouseEventHandler<HTMLDivElement> = () => {};
  const wheelStep = getDiffPerSliderStep(sliderRange, wheelFactor, step);

  handleDoubleClick = (event) => {
    if (
      event.target instanceof HTMLElement &&
      event.target.className.includes("ant-slider-handle") &&
      defaultValue != null
    )
      // @ts-ignore Argument of type 'number | number[]' is not assignable to parameter of type 'number'.
      //TypeScript doesn't understand that onChange always takes the type of defaultValue.
      onChange(defaultValue);
  };

  // differentiate between single value and range slider
  if (range === false || range == null) {
    if (!disableOnWheel) {
      handleWheelEvent = (event) => {
        const newValue = value - getWheelStepFromEvent(step, event.deltaY, wheelStep);
        const clampedNewValue = clamp(min, newValue, max);
        onChange(clampedNewValue);
      };
    }
  } else if (range === true || typeof range === "object") {
    if (!disableOnWheel) {
      handleWheelEvent = (event) => {
        const diff = getWheelStepFromEvent(step, event.deltaY, wheelStep);
        const newLowerValue = Math.round(value[0] + diff);
        const newUpperValue = Math.round(value[1] - diff);
        const clampedNewLowerValue = clamp(min, newLowerValue, Math.min(newUpperValue, max));
        const clampedNewUpperValue = clamp(newLowerValue, newUpperValue, max);
        onChange([clampedNewLowerValue, clampedNewUpperValue]);
      };
    }
  }

  return (
    <div onWheel={handleWheelEvent} onDoubleClick={handleDoubleClick} style={{ flexGrow: 1 }}>
      <AntdSlider {...props} />
    </div>
  );
}
