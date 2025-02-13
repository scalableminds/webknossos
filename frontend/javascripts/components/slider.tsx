import { Slider as AntdSlider, type SliderSingleProps } from "antd";
import type { SliderRangeProps } from "antd/lib/slider";
import { clamp } from "libs/utils";
import _ from "lodash";
import { useCallback, useEffect, useRef, useState } from "react";

const DEFAULT_WHEEL_FACTOR = 0.02;
const DEFAULT_STEP = 1;

type SliderProps = (SliderSingleProps | SliderRangeProps) & {
  wheelFactor?: number;
  onWheelDisabled?: boolean;
  onResetToDefault?: () => void;
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
  if (absDeltaY === 0 || step === 0) return 0;
  // Make sure that result is a multiple of step
  return step * Math.round((wheelStep * deltaY) / Math.abs(deltaY) / step);
};

export function Slider(props: SliderProps) {
  const {
    min,
    max,
    onChange,
    onResetToDefault,
    value,
    range,
    defaultValue,
    wheelFactor,
    onWheelDisabled,
    step,
    disabled,
  } = props;
  const isFocused = useRef(false);
  const sliderRef = useRef<HTMLDivElement>(null);

  const handleWheelEvent = useCallback(
    (event: { preventDefault: () => void; deltaY: number }) => {
      if (
        onWheelDisabled ||
        value == null ||
        min == null ||
        max == null ||
        !isFocused.current ||
        onChange == null
      )
        return;
      event.preventDefault();
      const diff = getWheelStepFromEvent(ensuredStep, event.deltaY, wheelStep);
      // differentiate between single value and range slider
      if (range === false || range == null) {
        const newValue = value - diff;
        const clampedNewValue = clamp(min, newValue, max);
        onChange(clampedNewValue);
      } else if (range === true || typeof range === "object") {
        const newLowerValue = Math.round(value[0] + diff);
        const newUpperValue = Math.round(value[1] - diff);
        const clampedNewLowerValue = clamp(min, newLowerValue, Math.min(newUpperValue, max));
        const clampedNewUpperValue = clamp(newLowerValue, newUpperValue, max);
        onChange([clampedNewLowerValue, clampedNewUpperValue]);
      }
    },
    [value, min, max, onChange, range, onWheelDisabled],
  );

  // Reacts onWheel is passive by default, this means that it can't preventDefault.
  // Thus we need to add the event listener manually.
  // (See https://github.com/facebook/react/pull/19654)
  useEffect(() => {
    const sliderElement = sliderRef.current;
    if (sliderElement) {
      sliderElement.addEventListener("wheel", handleWheelEvent, { passive: false });
      return () => {
        sliderElement.removeEventListener("wheel", handleWheelEvent);
      };
    }
  }, [handleWheelEvent]);

  if (min == null || max == null || onChange == null || value == null || disabled)
    return <AntdSlider {...props} />;
  const sliderRange = max - min;
  const ensuredStep = step || DEFAULT_STEP;

  const wheelStep = getDiffPerSliderStep(sliderRange, wheelFactor, ensuredStep);

  const handleDoubleClick: React.MouseEventHandler<HTMLDivElement> = (event) => {
    if (
      event.target instanceof HTMLElement &&
      event.target.className.includes("ant-slider-handle") &&
      defaultValue != null
    )
      if (onResetToDefault != null) {
        onResetToDefault();
      } else {
        // @ts-ignore Argument of type 'number | number[]' is not assignable to parameter of type 'number'.
        //TypeScript doesn't understand that onChange always takes the type of defaultValue.
        onChange(defaultValue);
      }
  };

  return (
    <div
      ref={sliderRef}
      onDoubleClick={handleDoubleClick}
      style={{ flexGrow: 1, touchAction: "none", userSelect: isFocused ? "none" : "auto" }}
      onFocus={() => (isFocused.current = true)}
      onBlur={() => (isFocused.current = false)}
    >
      <AntdSlider {...props} />
    </div>
  );
}
