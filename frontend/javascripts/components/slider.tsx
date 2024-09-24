import { Slider as AntdSlider, type SliderSingleProps } from "antd";
import type { SliderRangeProps } from "antd/lib/slider";

export function Slider(props: SliderSingleProps) {
  const { min, max, onChange, value } = props;
  if (onChange == null || value == null) return null;
  const minNotNull = min || 0;
  const maxNotNull = max || 0;
  const range = maxNotNull - minNotNull;
  return (
    <div
      onWheel={(event) => {
        const newValue = Math.round(value - (event.deltaY / Math.abs(event.deltaY)) * 0.02 * range);
        console.log(event, newValue);
        if (newValue < minNotNull) onChange(minNotNull);
        else if (newValue > maxNotNull) onChange(maxNotNull);
        else onChange(newValue);
      }}
    >
      <AntdSlider {...props} />
    </div>
  );
}

export function RangeSlider(props: SliderRangeProps) {
  const { min, max, onChange, value } = props;
  if (onChange == null || value == null) return null;
  const minNotNull = min || 0;
  const maxNotNull = max || 0;
  const range = maxNotNull - minNotNull;
  return (
    <div
      onWheel={(event) => {
        const diff = (event.deltaY / Math.abs(event.deltaY)) * 0.02 * range;
        const newValue = value.map((el) => Math.round(el - diff));
        if (newValue[0] > minNotNull && newValue[1] < maxNotNull) onChange(newValue);
      }}
    >
      <AntdSlider {...props} />
    </div>
  );
}
