import { Popover } from "antd";
import useThrottledCallback from "beautiful-react-hooks/useThrottledCallback";
import * as Utils from "libs/utils";
import type { Vector3, Vector4 } from "oxalis/constants";
import { useRef, useState } from "react";
import { HexColorInput, HexColorPicker, type RgbaColor, RgbaColorPicker } from "react-colorful";

export const ThrottledColorPicker = ({
  color,
  onChange,
}: {
  // TODO_c sync input and color picker
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
      {getColorInput(color, setValue)}
    </>
  );
};

const getPopover = (title: string, content: JSX.Element | null) => {
  return (
    <Popover content={content} trigger="click" overlayStyle={{ zIndex: 10000 }}>
      <div style={{ position: "relative", display: "inline-block", width: "100%" }}>{title}</div>
    </Popover>
  );
};

const getColorInput = (color: string, setValue: (newValue: string) => void) => {
  return (
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
  return getPopover(title, content);
}

const ThrottledRGBAColorPicker = ({
  color,
  onChangeColor,
}: {
  color: RgbaColor;
  onChangeColor: (color: RgbaColor) => void;
}) => {
  const [value, localSetValue] = useState(color);
  const throttledSetValue = useThrottledCallback(onChangeColor, [onChangeColor, value], 20);
  const setValue = (newValue: RgbaColor) => {
    localSetValue(newValue);
    throttledSetValue(newValue);
    console.log("set value", newValue);
  };
  const setValueFromHex = (color: string) => {
    const colorRgb = Utils.hexToRgb(color);
    setValue({ r: colorRgb[0], g: colorRgb[1], b: colorRgb[2], a: value.a });
  };
  const colorAsHex = Utils.rgbToHex([value.r, value.g, value.b]);
  return (
    <div style={{ marginRight: "10px" }}>
      <RgbaColorPicker color={value} onChange={setValue} />
      {getColorInput(colorAsHex, setValueFromHex)}
    </div>
  );
};

export function ChangeRGBAColorMenuItemContent({
  title,
  isDisabled,
  rgba,
  onSetColor,
}: {
  title: string;
  isDisabled: boolean;
  rgba: Vector4;
  onSetColor: (rgba: Vector4, createsNewUndoState: boolean) => void;
}) {
  const isFirstColorChange = useRef(true);
  const color = {
    r: rgba[0] * 255,
    g: rgba[1] * 255,
    b: rgba[2] * 255,
    a: rgba[3],
  };
  const onChangeColor = (color: RgbaColor) => {
    if (isDisabled) {
      return;
    }
    const colorRgb: Vector3 = [color.r, color.g, color.b];
    const newColor = Utils.map3((component) => component / 255, colorRgb);
    newColor.push(color.a);

    // Only create a new undo state on the first color change event.
    // All following color change events should mutate the most recent undo
    // state so that the undo stack is not filled on each mouse movement.
    onSetColor(newColor, isFirstColorChange.current);
    isFirstColorChange.current = false;
  };

  const content = isDisabled ? null : (
    <ThrottledRGBAColorPicker color={color} onChangeColor={onChangeColor} />
  );

  return getPopover(title, content);
}
