import { Slider as AntdSlider, type SliderSingleProps } from "antd";
import type { SliderRangeProps } from "antd/lib/slider";
import type { WheelEventHandler } from "react";

const getDiffPerSliderStep = (deltaY: number, sliderRange: number, factor: number = 0.02) =>
  (deltaY / Math.abs(deltaY)) * factor * sliderRange;

export function Slider(props: SliderSingleProps | SliderRangeProps) {
  const { min, max, onChange, value, range, defaultValue } = props;
  if (min == null || max == null || onChange == null || value == null)
    return <AntdSlider {...props} />;
  const sliderRange = max - min;
  let handleWheelEvent: WheelEventHandler<HTMLDivElement> = () => {};
  let handleDoubleClick: React.MouseEventHandler<HTMLDivElement> = () => {};
  if (range === false || range == null) {
    handleWheelEvent = (event) => {
      const newValue = Math.round(value - getDiffPerSliderStep(event.deltaY, sliderRange));
      if (newValue < min) onChange(min);
      else if (newValue > max) onChange(max);
      else onChange(newValue);
    };
    handleDoubleClick = (event) => {
      if (event.target instanceof HTMLElement) {
        if (event.target.className.includes("ant-slider-handle")) {
          if (defaultValue != null) onChange(defaultValue);
        }
      }
    };
  } else if (range === true || typeof range === "object") {
    handleWheelEvent = (event) => {
      const newValue = value.map((el) =>
        Math.round(el - getDiffPerSliderStep(event.deltaY, sliderRange)),
      );
      if (newValue[0] > min && newValue[1] < max) onChange(newValue);
    };
  }
  return (
    <div onWheel={handleWheelEvent} onDoubleClick={handleDoubleClick}>
      <AntdSlider {...props} />
    </div>
  );
}
