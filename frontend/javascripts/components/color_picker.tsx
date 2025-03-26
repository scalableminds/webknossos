import { InputNumber, Popover } from "antd";
import useThrottledCallback from "beautiful-react-hooks/useThrottledCallback";
import * as Utils from "libs/utils";
import type { Vector3, Vector4 } from "oxalis/constants";
import { useRef, useState } from "react";
import type { CSSProperties } from "react";
import { HexColorInput, HexColorPicker, type RgbaColor, RgbaColorPicker } from "react-colorful";

const COLOR_PICKER_WIDTH = 200;
const RELATIVE_OPACITY_INPUT_WIDTH = 0.25;

const getPopover = (title: string, content: JSX.Element | null) => {
  return (
    <Popover content={content} trigger="click" overlayStyle={{ zIndex: 10000 }}>
      <div style={{ position: "relative", display: "inline-block", width: "100%" }}>{title}</div>
    </Popover>
  );
};

const inputStyle: CSSProperties = {
  background: "var(--ant-component-background)",
  textAlign: "center",
  marginTop: 12,
  color: "var(--ant-color-text)",
  borderRadius: 4,
  border: "1px solid var(--ant-border-radius)",
};

const getColorInput = (
  color: string,
  setValue: (newValue: string) => void,
  width: string | number = "100%",
) => {
  return <HexColorInput color={color} onChange={setValue} style={{ width, ...inputStyle }} />;
};

const ThrottledColorPicker = ({
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
    <div style={{ marginRight: 10 }}>
      <HexColorPicker color={value} onChange={setValue} />
      {getColorInput(value, setValue)}
    </div>
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
  };
  const setValueFromHex = (color: string) => {
    const colorRgb = Utils.hexToRgb(color);
    setValue({ r: colorRgb[0], g: colorRgb[1], b: colorRgb[2], a: value.a });
  };

  const maybeGetInfoText = () => {
    return (
      <div style={{ wordBreak: "break-word", fontSize: 12, lineHeight: 1, marginTop: 8 }}>
        Note that the opacity will only affect the mesh in the 3D viewport.
      </div>
    );
  };

  const getOpacityInput = () => {
    return (
      <InputNumber
        style={{ width: COLOR_PICKER_WIDTH * RELATIVE_OPACITY_INPUT_WIDTH, ...inputStyle }}
        size="small"
        variant="borderless"
        type="number"
        min={0}
        max={1}
        step={0.1}
        value={value.a}
        onChange={(newOpacity) => {
          setValue({ r: value.r, g: value.g, b: value.b, a: newOpacity || 0 });
        }}
      />
    );
  };
  const valueAsHex = Utils.rgbToHex([value.r, value.g, value.b]);
  const hexInputWidth = COLOR_PICKER_WIDTH * (1 - RELATIVE_OPACITY_INPUT_WIDTH);
  return (
    <div style={{ marginRight: 10, width: COLOR_PICKER_WIDTH }}>
      <RgbaColorPicker color={value} onChange={setValue} style={{ width: "100%" }} />
      <div>
        {getColorInput(valueAsHex, setValueFromHex, hexInputWidth)}
        {getOpacityInput()}
      </div>
      {maybeGetInfoText()}
    </div>
  );
};

export function ChangeRGBAColorMenuItemContent({
  title,
  isDisabled,
  color: rgba,
  onSetColor,
}: {
  title: string;
  isDisabled: boolean;
  color: Vector4;
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
    if (isDisabled) return;
    const colorRgb: Vector3 = [color.r, color.g, color.b];
    const newColor: Vector4 = [...Utils.map3((component) => component / 255, colorRgb), color.a];

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
