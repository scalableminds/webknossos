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
  step: number,
) => {
  let result = factor * sliderRange;
  if (result < step) return step;
  return result;
};

const getWheelStepFromEvent = (step: number, deltaY: number, wheelStep: number) => {
  const absDeltaY = Math.abs(deltaY);
  if (absDeltaY === 0 || step === 0) throw new Error("Step and deltaY must not be 0");
  // Make sure that result is a multiple of step
  return step * Math.round((wheelStep * deltaY) / Math.abs(deltaY) / step);
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
    onWheelDisabled,
    step,
    disabled,
  } = props;
  if (min == null || max == null || onChange == null || value == null || disabled)
    return <AntdSlider {...props} />;
  const sliderRange = max - min;
  const ensuredStep = step || DEFAULT_STEP;
  let handleWheelEvent: WheelEventHandler<HTMLDivElement> = () => { };
  let handleDoubleClick: React.MouseEventHandler<HTMLDivElement> = () => { };
  const wheelStep = getDiffPerSliderStep(sliderRange, wheelFactor, ensuredStep);

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
  if (onWheelDisabled) return;
  if (range === false || range == null) {
    handleWheelEvent = (event) => {
      if (Math.abs(event.deltaY) === 0) return;
      const newValue = value - getWheelStepFromEvent(ensuredStep, event.deltaY, wheelStep);
      const clampedNewValue = clamp(min, newValue, max);
      onChange(clampedNewValue);
    };
  } else if (range === true || typeof range === "object") {
    handleWheelEvent = (event) => {
      const diff = getWheelStepFromEvent(ensuredStep, event.deltaY, wheelStep);
      const newLowerValue = Math.round(value[0] + diff);
      const newUpperValue = Math.round(value[1] - diff);
      const clampedNewLowerValue = clamp(min, newLowerValue, Math.min(newUpperValue, max));
      const clampedNewUpperValue = clamp(newLowerValue, newUpperValue, max);
      onChange([clampedNewLowerValue, clampedNewUpperValue]);
    };
  }

  return (
    <div onWheel={handleWheelEvent} onDoubleClick={handleDoubleClick} style={{ flexGrow: 1 }}>
      <AntdSlider {...props} />
    </div>
  );
}
