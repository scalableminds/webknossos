import { ColorPicker } from "antd";
import type { Color } from "antd/es/color-picker";
import useThrottledCallback from "beautiful-react-hooks/useThrottledCallback";
import { map3 } from "libs/utils";
import type { CSSProperties, ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import type { Vector3, Vector4 } from "viewer/constants";

type RgbaColor = { r: number; g: number; b: number; a: number };

// The channels need to be rounded because antd cannot handle fractional rgb values.
const toCssColor = ({ r, g, b, a }: RgbaColor) =>
  `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},${a})`;

// The pickers are usually rendered as the label of a context menu item, so the
// popup needs to be placed on top of that menu.
const pickerStyles = { popup: { root: { zIndex: 10000 } } };

const triggerStyle: CSSProperties = {
  position: "relative",
  display: "inline-block",
  width: "100%",
};

const descriptionStyle: CSSProperties = {
  wordBreak: "break-word",
  fontSize: 12,
  lineHeight: 1.2,
  marginTop: 8,
};

const ThrottledColorPicker = ({
  color,
  onChangeColor,
  title,
  isDisabled,
  disabledAlpha,
  description,
}: {
  color: RgbaColor;
  onChangeColor: (color: RgbaColor) => void;
  title: string;
  isDisabled?: boolean;
  disabledAlpha?: boolean;
  description?: ReactNode;
}) => {
  const [value, localSetValue] = useState(color);
  const throttledSetValue = useThrottledCallback(onChangeColor, [onChangeColor], 20);

  // Sync local state when the external color changes. The individual components are
  // used as dependencies because the color object is re-created on each render.
  useEffect(() => {
    localSetValue({ r: color.r, g: color.g, b: color.b, a: color.a });
  }, [color.r, color.g, color.b, color.a]);

  const setValue = (newColor: Color) => {
    const newValue = newColor.toRgb();
    localSetValue(newValue);
    throttledSetValue(newValue);
  };

  return (
    <ColorPicker
      value={toCssColor(value)}
      onChange={setValue}
      disabled={isDisabled}
      disabledAlpha={disabledAlpha}
      styles={pickerStyles}
      panelRender={
        description == null
          ? undefined
          : (panel) => (
              <>
                {panel}
                <div style={descriptionStyle}>{description}</div>
              </>
            )
      }
    >
      <div style={triggerStyle}>{title}</div>
    </ColorPicker>
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
  const [r, g, b] = map3((value) => value * 255, rgb);
  const onChangeColor = (color: RgbaColor) => {
    if (isDisabled) {
      return;
    }
    const newColor = map3((component) => component / 255, [color.r, color.g, color.b]);

    // Only create a new undo state on the first color change event.
    // All following color change events should mutate the most recent undo
    // state so that the undo stack is not filled on each mouse movement.
    onSetColor(newColor, isFirstColorChange.current);
    isFirstColorChange.current = false;
  };

  return (
    <ThrottledColorPicker
      title={title}
      color={{ r, g, b, a: 1 }}
      onChangeColor={onChangeColor}
      isDisabled={isDisabled}
      disabledAlpha
    />
  );
}

export function ChangeRGBAColorMenuItemContent({
  title,
  rgba,
  onSetColor,
}: {
  title: string;
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
    const newColor: Vector4 = [
      ...map3((component) => component / 255, [color.r, color.g, color.b]),
      color.a,
    ];

    // Only create a new undo state on the first color change event.
    // All following color change events should mutate the most recent undo
    // state so that the undo stack is not filled on each mouse movement.
    onSetColor(newColor, isFirstColorChange.current);
    isFirstColorChange.current = false;
  };

  return (
    <ThrottledColorPicker
      title={title}
      color={color}
      onChangeColor={onChangeColor}
      description="Note that the opacity will only affect the mesh in the 3D viewport."
    />
  );
}
