import React, { useState } from "react";
import { Popover } from "antd";
import * as Utils from "libs/utils";
import { HexColorInput, HexColorPicker } from "react-colorful";
import useThrottledCallback from "beautiful-react-hooks/useThrottledCallback";
import type { Vector3 } from "oxalis/constants";

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
          color: "var(--ant-text)",
          borderRadius: "4px",
          border: "1px solid var(--ant-border-base)",
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
  hidePickerIcon,
}: {
  title: string;
  isDisabled: boolean;
  onSetColor: (rgb: Vector3) => void;
  rgb: Vector3;
  hidePickerIcon?: boolean;
}) {
  const color = Utils.rgbToHex(Utils.map3((value) => value * 255, rgb));
  const onChangeColor = (colorStr: string) => {
    if (isDisabled) {
      return;
    }
    const colorRgb = Utils.hexToRgb(colorStr);
    const newColor = Utils.map3((component) => component / 255, colorRgb);
    onSetColor(newColor);
  };
  const content = isDisabled ? null : (
    <ThrottledColorPicker color={color} onChange={onChangeColor} />
  );
  return (
    <Popover content={content} trigger="click" overlayStyle={{ zIndex: 10000 }}>
      <div style={{ position: "relative", display: "inline-block", width: "100%" }}>
        {hidePickerIcon ? null : (
          <i
            className="fas fa-eye-dropper fa-sm"
            style={{
              cursor: "pointer",
            }}
          />
        )}{" "}
        {title}
      </div>
    </Popover>
  );
}
