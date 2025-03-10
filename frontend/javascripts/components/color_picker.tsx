import { Popover } from "antd";
import useThrottledCallback from "beautiful-react-hooks/useThrottledCallback";
import * as Utils from "libs/utils";
import type { Vector3 } from "oxalis/constants";
import { useRef, useState } from "react";
import { HexColorInput, HexColorPicker } from "react-colorful";

export const ThrottledColorPicker = ({
  color,
  onChange,
}: {
  color: string;
  onChange: (color: string) => void;
}) => {
  const [value, localSetValue] = useState(color);
  const throttledSetValue = useThrottledCallback(onChange, [onChange], 20);
  const setValue = (newValue: string) => {
    localSetValue(newValue);
    throttledSetValue(newValue);
  };
  return (
    <>
      <HexColorPicker color={value} onChange={setValue} />
      <HexColorInput
        color={color}
        onChange={setValue}
        style={{
          background: "var(--ant-component-background)",
          textAlign: "center",
          width: "100%",
          marginTop: "12px",
          color: "var(--ant-color-text)",
          borderRadius: "4px",
          border: "1px solid var(--ant-border-radius)",
        }}
      />
    </>
  );
};

export function ChangeColorMenuItemContent({
  title,
  isDisabled,
  onSetColor,
  rgb,
}: {
  title: string;
  isDisabled: boolean;
  onSetColor: (rgb: Vector3, createsNewUndoState: boolean) => void;
  rgb: Vector3;
}) {
  const isFirstColorChange = useRef(true);
  const color = Utils.rgbToHex(Utils.map3((value) => value * 255, rgb));
  const onChangeColor = (colorStr: string) => {
    if (isDisabled) {
      return;
    }
    const colorRgb = Utils.hexToRgb(colorStr);
    const newColor = Utils.map3((component) => component / 255, colorRgb);

    // Only create a new undo state on the first color change event.
    // All following color change events should mutate the most recent undo
    // state so that the undo stack is not filled on each mouse movement.
    onSetColor(newColor, isFirstColorChange.current);
    isFirstColorChange.current = false;
  };

  const content = isDisabled ? null : (
    <ThrottledColorPicker color={color} onChange={onChangeColor} />
  );
  return (
    <Popover content={content} trigger="click" overlayStyle={{ zIndex: 10000 }}>
      <div style={{ position: "relative", display: "inline-block", width: "100%" }}>{title}</div>
    </Popover>
  );
}
