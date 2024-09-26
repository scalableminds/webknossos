import { Slider as AntdSlider, type SliderSingleProps } from "antd";
import type { SliderRangeProps } from "antd/lib/slider";
import type { WheelEventHandler } from "react";

type SliderProps = (SliderSingleProps | SliderRangeProps) & {
  stepSize?: number;
  disableOnWheel?: boolean;
};

const getDiffPerSliderStep = (
  deltaY: number,
  sliderRange: number,
  factor: number | undefined = 0.02,
) => (deltaY / Math.abs(deltaY)) * (factor || 0.2) * sliderRange;

export function Slider(props: SliderProps) {
  const { min, max, onChange, value, range, defaultValue, stepSize, disableOnWheel } = props;
  if (min == null || max == null || onChange == null || value == null)
    return <AntdSlider {...props} />;
  const sliderRange = max - min;
  let handleWheelEvent: WheelEventHandler<HTMLDivElement> = () => {};
  let handleDoubleClick: React.MouseEventHandler<HTMLDivElement> = () => {};
  if (!disableOnWheel) {
    if (range === false || range == null) {
      handleWheelEvent = (event) => {
        const newValue = Math.round(
          value - getDiffPerSliderStep(event.deltaY, sliderRange, stepSize),
        );
        if (newValue < min) onChange(min);
        else if (newValue > max) onChange(max);
        else onChange(newValue);
      };
      // Sadly this code is duplicated because TypeScript doesn't understand that onChange
      // always takes the type of defaultValue.
      handleDoubleClick = (event) => {
        if (event.target instanceof HTMLElement) {
          if (event.target.className.includes("ant-slider-handle")) {
            if (defaultValue != null) onChange(defaultValue);
          }
        }
      };
    } else if (range === true || typeof range === "object") {
      handleWheelEvent = (event) => {
        const newMin = Math.round(
          value[0] + getDiffPerSliderStep(event.deltaY, sliderRange, stepSize),
        );
        const newMax = Math.round(
          value[1] - getDiffPerSliderStep(event.deltaY, sliderRange, stepSize),
        );
        if (newMin >= min && newMax <= max && min < max) onChange([newMin, newMax]);
      };
      handleDoubleClick = (event) => {
        if (event.target instanceof HTMLElement) {
          if (event.target.className.includes("ant-slider-handle")) {
            if (defaultValue != null) onChange(defaultValue);
          }
        }
      };
    }
  }

  return (
    <div onWheel={handleWheelEvent} onDoubleClick={handleDoubleClick} style={{ flexGrow: 1 }}>
      <AntdSlider {...props} />
    </div>
  );
}
