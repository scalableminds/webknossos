import { type InputProps, Space } from "antd";
import type React from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ServerBoundingBoxMinMaxTypeTuple } from "types/api_types";
import type { Vector3, Vector6 } from "viewer/constants";
import InputComponent from "viewer/view/components/input_component";
import { stringToNumberArray } from "./utils";
import noop from "lodash/noop";

const CHARACTER_WIDTH_PX = 8;

type VectorInputProps<T> = Omit<InputProps, "value" | "onChange" | "defaultValue"> & {
  value?: T | string;
  onChange?: (value: T) => void;
  changeOnlyOnBlur?: boolean;
  allowDecimals?: boolean;
  autoSize?: boolean;
  placeHolder?: string;
};

function vectorToText<T extends number[]>(value: T | string): string {
  return Array.isArray(value) ? value.join(", ") : value;
}

function useVectorInput<T extends number[]>(
  defaultValue: T,
  value?: T | string,
  onChange: (value: T) => void = noop,
  changeOnlyOnBlur = false,
  allowDecimals = false,
) {
  if (value === undefined) value = defaultValue;

  const [isEditing, setIsEditing] = useState(false);
  const [text, setText] = useState(() => vectorToText(value));
  const [isValid, setIsValid] = useState(true);

  // Sync external value changes when not editing
  useEffect(() => {
    if (!isEditing) {
      setText(vectorToText(value));
      setIsValid(true);
    }
  }, [value, isEditing]);

  const sanitizeAndPad = useCallback(
    (inputText: string): T => {
      const cleaned = inputText.replace(allowDecimals ? /[^0-9,.]/g : /[^0-9,]/g, "");
      const parsed = cleaned
        .split(",")
        .map((el) => Number.parseFloat(el) || 0)
        .slice(0, defaultValue.length);

      // Pad with zeros if needed
      while (parsed.length < defaultValue.length) {
        parsed.push(0);
      }

      return parsed as T;
    },
    [allowDecimals, defaultValue.length],
  );

  const handleChange = useCallback(
    (evt: React.ChangeEvent<HTMLInputElement>) => {
      const newText = evt.target.value;

      // Validate input characters
      const validChars = allowDecimals ? /^[\d\s,.]*$/ : /^[\d\s,]*$/;
      if (!validChars.test(newText)) {
        return;
      }

      const parsed = stringToNumberArray(newText);
      const formatValid = parsed.length === defaultValue.length;

      setText(newText);
      setIsValid(formatValid);

      // Update immediately if valid and not in blur-only mode
      if (formatValid && !changeOnlyOnBlur) {
        onChange(parsed as T);
      }
    },
    [allowDecimals, defaultValue.length, changeOnlyOnBlur, onChange],
  );

  const handleFocus = useCallback(() => {
    setIsEditing(true);
    setText(vectorToText(value));
    setIsValid(true);
  }, [value]);

  const handleBlur = useCallback(() => {
    setIsEditing(false);

    if (isValid) {
      // In blur-only mode, commit the change
      if (changeOnlyOnBlur) {
        onChange(stringToNumberArray(text) as T);
      } else {
        // Otherwise, reset to the current value
        setText(vectorToText(value));
      }
    } else {
      // Invalid input: sanitize and commit
      const sanitized = sanitizeAndPad(text);
      onChange(sanitized);
      setText(vectorToText(sanitized));
      setIsValid(true);
    }
  }, [isValid, changeOnlyOnBlur, text, value, sanitizeAndPad, onChange]);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key !== "ArrowUp" && event.key !== "ArrowDown") {
        return;
      }

      event.preventDefault();
      const input = event.target as HTMLInputElement;
      const vec = stringToNumberArray(input.value) as T;

      // Find which vector element the cursor is in
      const commasBeforeCursor =
        input.value.slice(0, input.selectionStart || 0).split(",").length - 1;

      vec[commasBeforeCursor] += event.key === "ArrowUp" ? 1 : -1;
      onChange(vec);
      setText(vectorToText(vec));
    },
    [onChange],
  );

  return {
    text,
    handleChange,
    handleFocus,
    handleBlur,
    handleKeyDown,
  };
}

export function Vector3Input({
  value,
  onChange,
  changeOnlyOnBlur,
  allowDecimals,
  autoSize,
  style,
  ...props
}: VectorInputProps<Vector3>) {
  const { text, handleChange, handleFocus, handleBlur, handleKeyDown } = useVectorInput(
    [0, 0, 0],
    value,
    onChange,
    changeOnlyOnBlur,
    allowDecimals,
  );

  const inputStyle = useMemo(() => {
    if (!autoSize) return style;

    return {
      ...style,
      width: text.length * CHARACTER_WIDTH_PX + 25,
    };
  }, [autoSize, style, text.length]);

  return (
    <InputComponent
      {...props}
      value={text}
      onChange={handleChange}
      onFocus={handleFocus}
      onBlur={handleBlur}
      onKeyDown={handleKeyDown}
      style={inputStyle}
    />
  );
}

export function Vector6Input({
  value,
  onChange,
  changeOnlyOnBlur,
  allowDecimals,
  autoSize,
  style,
  ...props
}: VectorInputProps<Vector6>) {
  const { text, handleChange, handleFocus, handleBlur, handleKeyDown } = useVectorInput(
    [0, 0, 0, 0, 0, 0],
    value,
    onChange,
    changeOnlyOnBlur,
    allowDecimals,
  );

  const inputStyle = useMemo(() => {
    if (!autoSize) return style;

    return {
      ...style,
      width: text.length * CHARACTER_WIDTH_PX + 25,
    };
  }, [autoSize, style, text.length]);

  return (
    <InputComponent
      {...props}
      value={text}
      onChange={handleChange}
      onFocus={handleFocus}
      onBlur={handleBlur}
      onKeyDown={handleKeyDown}
      style={inputStyle}
    />
  );
}

export function ArbitraryVectorInput({
  value,
  onChange,
  changeOnlyOnBlur,
  allowDecimals,
  autoSize,
  vectorLength = 3,
  style,
  vectorLabel,
  ...props
}: VectorInputProps<number[]> & { vectorLength?: number; vectorLabel?: string }) {
  const defaultValue = useMemo(() => Array(vectorLength).fill(0), [vectorLength]);

  const { text, handleChange, handleFocus, handleBlur, handleKeyDown } = useVectorInput(
    defaultValue,
    value,
    onChange,
    changeOnlyOnBlur,
    allowDecimals,
  );

  const inputStyle = useMemo(() => {
    if (!autoSize) return style;

    const vectorLabelWidth =
      typeof vectorLabel === "string" ? 20 + CHARACTER_WIDTH_PX * vectorLabel.length : 0;

    return {
      ...style,
      width: text.length * CHARACTER_WIDTH_PX + 25 + vectorLabelWidth,
    };
  }, [autoSize, style, text.length, vectorLabel]);

  if (vectorLabel) {
    return (
      <Space.Compact style={inputStyle}>
        <Space.Addon>{vectorLabel}</Space.Addon>
        <InputComponent
          {...props}
          value={text}
          onChange={handleChange}
          onFocus={handleFocus}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
        />
      </Space.Compact>
    );
  }

  return (
    <InputComponent
      {...props}
      value={text}
      onChange={handleChange}
      onFocus={handleFocus}
      onBlur={handleBlur}
      onKeyDown={handleKeyDown}
      style={inputStyle}
    />
  );
}

type BoundingBoxInputProps = Omit<InputProps, "value" | "defaultValue"> & {
  value?: ServerBoundingBoxMinMaxTypeTuple;
  onChange?: (value: ServerBoundingBoxMinMaxTypeTuple) => void;
};

const emptyBoundingBox = {
  topLeft: [0, 0, 0] as [number, number, number],
  width: 0,
  height: 0,
  depth: 0,
};

export function BoundingBoxInput({
  value = emptyBoundingBox,
  onChange = noop,
  ...props
}: BoundingBoxInputProps) {
  const vector6Value = useMemo(() => {
    const { topLeft, width, height, depth } = value;
    const [x, y, z] = topLeft;
    return [x, y, z, width, height, depth] as Vector6;
  }, [value]);

  const handleChange = useCallback(
    ([x, y, z, width, height, depth]: Vector6) => {
      onChange({
        topLeft: [x, y, z],
        width,
        height,
        depth,
      });
    },
    [onChange],
  );

  return <Vector6Input {...props} value={vector6Value} changeOnlyOnBlur onChange={handleChange} />;
}
