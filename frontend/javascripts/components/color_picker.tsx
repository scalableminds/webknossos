import { InputNumber, Popover } from "antd";
import useThrottledCallback from "beautiful-react-hooks/useThrottledCallback";
import * as Utils from "libs/utils";
import type { Vector3, Vector4 } from "oxalis/constants";
import Constants from "oxalis/constants";
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
  onChangeColor,
  isRGBA = false,
}: {
  color: RgbaColor;
  onChangeColor: (color: RgbaColor) => void;
  isRGBA?: boolean;
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

  const getOpacityInput = () => {
    if (!isRGBA) return null; // Only show opacity input for RGBA
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

  const maybeGetInfoText = () => {
    if (!isRGBA) return null;
    return (
      <div style={{ wordBreak: "break-word", fontSize: 12, lineHeight: 1, marginTop: 8 }}>
        Note that the opacity will only affect the mesh in the 3D viewport.
      </div>
    );
  };

  const valueAsHex = Utils.rgbToHex([value.r, value.g, value.b]);
  const hexInputWidth = COLOR_PICKER_WIDTH * (1 - RELATIVE_OPACITY_INPUT_WIDTH);

  return (
    <div style={{ marginRight: 10, width: COLOR_PICKER_WIDTH }}>
      {isRGBA ? (
        <RgbaColorPicker color={value} onChange={setValue} style={{ width: "100%" }} />
      ) : (
        <HexColorPicker color={valueAsHex} onChange={setValueFromHex} style={{ width: "100%" }} />
      )}
      <div>
        {getColorInput(valueAsHex, setValueFromHex, hexInputWidth)}
        {getOpacityInput()}
      </div>
      {maybeGetInfoText()}
    </div>
  );
};

export function ChangeColorMenuItemContent({
  title,
  isDisabled,
  color,
  onSetColor,
  isRGBA = false,
}: {
  title: string;
  isDisabled: boolean;
  color: Vector4;
  onSetColor: (color: Vector4, createsNewUndoState: boolean) => void;
  isRGBA?: boolean;
}) {
  const isFirstColorChange = useRef(true);

  const initialColor = {
    r: color[0] * 255,
    g: color[1] * 255,
    b: color[2] * 255,
    a: isRGBA ? color[3] : Constants.DEFAULT_MESH_OPACITY,
  };

  const onChangeColor = (newColor: RgbaColor) => {
    if (isDisabled) return;

    const colorRgb: Vector3 = [newColor.r, newColor.g, newColor.b];
    const updatedColor: Vector4 = [
      ...Utils.map3((component) => component / 255, colorRgb),
      isRGBA ? newColor.a : Constants.DEFAULT_MESH_OPACITY,
    ];

    // Only create a new undo state on the first color change event.
    onSetColor(updatedColor, isFirstColorChange.current);
    isFirstColorChange.current = false;
  };

  const content = isDisabled ? null : (
    <ThrottledColorPicker color={initialColor} onChangeColor={onChangeColor} isRGBA={isRGBA} />
  );

  return getPopover(title, content);
}

/* export function ChangeRGBAColorMenuItemContent({
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
    <ThrottledColorPicker color={color} onChangeColor={onChangeColor} isRGBA={true} />
  );

  return getPopover(title, content);
} */
