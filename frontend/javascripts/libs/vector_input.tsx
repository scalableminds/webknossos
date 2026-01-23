import { type InputProps, type InputRef, Space } from "antd";
import noop from "lodash/noop";
import type React from "react";
import { forwardRef, useCallback, useEffect, useMemo, useState } from "react";
import type { ServerBoundingBoxMinMaxTypeTuple } from "types/api_types";
import type { Vector3, Vector6 } from "viewer/constants";
import InputComponent from "viewer/view/components/input_component";
import { stringToNumberArray } from "./utils";

const CHARACTER_WIDTH_PX = 8;

type VectorInputProps<T> = Omit<InputProps, "value" | "onChange" | "defaultValue"> & {
  value?: T | string;
  onChange?: (value: T) => void;
  changeOnlyOnBlur?: boolean;
  allowDecimals?: boolean;
  disableAutoSize?: boolean;
  placeHolder?: string;
};

function vectorToText<T extends number[]>(value: T | string): string {
  return Array.isArray(value) ? value.join(", ") : value;
}

/**
 * A custom hook that manages the state, sanitization, and automatic width calculation
 * for vector-style text inputs.
 * * It synchronizes raw string input with numerical arrays, provides keyboard
 * navigation for incrementing values, and calculates dynamic CSS widths.
 */
function useVectorInput<T extends number[]>(
  defaultValue: T,
  value?: T | string,
  onChange: (value: T) => void = noop,
  changeOnlyOnBlur = false,
  allowDecimals = false,
  disableAutoSize = false,
  style?: React.CSSProperties,
) {
  if (value === undefined) value = defaultValue;

  const [isEditing, setIsEditing] = useState(false);
  const [text, setText] = useState(() => vectorToText(value));
  const [isValid, setIsValid] = useState(true);

  useEffect(() => {
    if (!isEditing) {
      setText(vectorToText(value));
      setIsValid(true);
    }
  }, [value, isEditing]);

  const sanitizeAndPad = useCallback(
    (inputText: string): T => {
      const cleaned = inputText.replace(allowDecimals ? /[^0-9,.\-]/g : /[^0-9,\-]/g, "");
      const parsed = cleaned
        .split(",")
        .map((el) => Number.parseFloat(el) || 0)
        .slice(0, defaultValue.length);

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

      // We set the text immediately so the width can grow
      // even if the format isn't "valid" yet (e.g., trailing comma)
      setText(newText);

      const parsed = stringToNumberArray(newText);
      const formatValid = parsed.length === defaultValue.length;
      setIsValid(formatValid);

      if (formatValid && !changeOnlyOnBlur) {
        onChange(parsed as T);
      }
    },
    [defaultValue.length, changeOnlyOnBlur, onChange],
  );

  const handleFocus = useCallback(() => {
    setIsEditing(true);
    setText(vectorToText(value));
    setIsValid(true);
  }, [value]);

  const handleBlur = useCallback(() => {
    setIsEditing(false);

    // On blur, we always sanitize to ensure we end back in a valid state
    const sanitized = sanitizeAndPad(text);
    const sanitizedText = vectorToText(sanitized);

    onChange(sanitized);
    setText(sanitizedText);
    setIsValid(true);
  }, [text, sanitizeAndPad, onChange]);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      /* Increment/decrement current value when using arrow up/down */
      if (event.key !== "ArrowUp" && event.key !== "ArrowDown") {
        return;
      }

      event.preventDefault();
      const input = event.target as HTMLInputElement;
      const vec = stringToNumberArray(input.value) as T;

      // Find which vector element the cursor is in
      const commasBeforeCursor =
        input.value.slice(0, input.selectionStart || 0).split(",").length - 1;

      if (Number.isNaN(vec[commasBeforeCursor])) {
        vec[commasBeforeCursor] = 0;
      }
      const increment = event.key === "ArrowUp" ? 1 : -1;
      vec[commasBeforeCursor] += increment;
      onChange(vec);
      setText(vectorToText(vec));
    },
    [onChange],
  );
  const styleWithAutomaticWidth = useMemo(() => {
    if (disableAutoSize) return style;

    // Use the raw text length to ensure the input grows while typing
    // Added a small buffer for the cursor and padding
    const width = Math.max(text.length, 1) * CHARACTER_WIDTH_PX + 10;

    return {
      ...style,
      width: `${width}px`,
      minWidth: 86, // size of "0, 0, 0"
    };
  }, [disableAutoSize, text, style]);

  return {
    text,
    handleChange,
    handleFocus,
    handleBlur,
    handleKeyDown,
    styleWithAutomaticWidth,
  };
}

/**
 * A specialized input for 3D vectors (x, y, z).
 * Automatically handles comma-separated formatting, sanitization on blur,
 * and dynamic width adjustment based on text length.
 */
export const Vector3Input = forwardRef<InputRef, VectorInputProps<Vector3>>(
  (
    { value, onChange, changeOnlyOnBlur, allowDecimals, style, disableAutoSize = false, ...props },
    ref,
  ) => {
    const { text, handleChange, handleFocus, handleBlur, handleKeyDown, styleWithAutomaticWidth } =
      useVectorInput(
        [0, 0, 0],
        value,
        onChange,
        changeOnlyOnBlur,
        allowDecimals,
        disableAutoSize,
        style,
      );

    return (
      <InputComponent
        {...props}
        ref={ref}
        value={text}
        onChange={handleChange}
        onFocus={handleFocus}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        style={styleWithAutomaticWidth}
      />
    );
  },
);

/**
 * A specialized input for 6D vectors (x, y, z, w, h, d).
 * Automatically handles comma-separated formatting, sanitization on blur,
 * and dynamic width adjustment based on text length.
 */
export const Vector6Input = forwardRef<InputRef, VectorInputProps<Vector6>>(
  (
    { value, onChange, changeOnlyOnBlur, allowDecimals, disableAutoSize = false, style, ...props },
    ref,
  ) => {
    const { text, handleChange, handleFocus, handleBlur, handleKeyDown, styleWithAutomaticWidth } =
      useVectorInput(
        [0, 0, 0, 0, 0, 0],
        value,
        onChange,
        changeOnlyOnBlur,
        allowDecimals,
        disableAutoSize,
        style,
      );

    return (
      <InputComponent
        {...props}
        ref={ref}
        value={text}
        onChange={handleChange}
        onFocus={handleFocus}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        style={styleWithAutomaticWidth}
      />
    );
  },
);

/**
 * A specialized input for arbitrary-length vectors.
 * Automatically handles comma-separated formatting, sanitization on blur,
 * and dynamic width adjustment based on text length.
 */
export const ArbitraryVectorInput = forwardRef<
  InputRef,
  VectorInputProps<number[]> & { vectorLength?: number; vectorLabel?: string }
>(
  (
    {
      value,
      onChange,
      changeOnlyOnBlur,
      allowDecimals,
      disableAutoSize = false,
      vectorLength = 3,
      style,
      vectorLabel,
      ...props
    },
    ref,
  ) => {
    const defaultValue = useMemo(() => Array(vectorLength).fill(0), [vectorLength]);

    const { text, handleChange, handleFocus, handleBlur, handleKeyDown, styleWithAutomaticWidth } =
      useVectorInput(
        defaultValue,
        value,
        onChange,
        changeOnlyOnBlur,
        allowDecimals,
        disableAutoSize,
        style,
      );

    if (vectorLabel) {
      return (
        <Space.Compact style={styleWithAutomaticWidth}>
          <Space.Addon>{vectorLabel}</Space.Addon>
          <InputComponent
            {...props}
            ref={ref}
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
        ref={ref}
        value={text}
        onChange={handleChange}
        onFocus={handleFocus}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        style={styleWithAutomaticWidth}
      />
    );
  },
);

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

/**
 * A composite input specifically for server-side bounding box objects.
 * * Maps a `{ topLeft: [x,y,z], width, height, depth }` object to a 6-element
 * vector input. This component defaults to `changeOnlyOnBlur` to ensure
 * complex data structures are only updated once the full vector is valid.
 */
export const BoundingBoxInput = forwardRef<InputRef, BoundingBoxInputProps>(
  ({ value = emptyBoundingBox, onChange = noop, ...props }, ref) => {
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

    return (
      <Vector6Input
        {...props}
        ref={ref}
        value={vector6Value}
        changeOnlyOnBlur
        onChange={handleChange}
        disableAutoSize={false}
      />
    );
  },
);
