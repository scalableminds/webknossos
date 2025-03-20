import { Input, type InputProps } from "antd";
import FastTooltip from "components/fast_tooltip";
import { useCallback, useEffect, useState } from "react";

export function InputWithUpdateOnBlur({
  value,
  onChange,
  onBlur,
  validate,
  ...props
}: {
  value: string;
  validate?: (value: string) => string | null;
  onChange: (value: string) => void;
} & Omit<InputProps, "onChange">) {
  const [localValue, setLocalValue] = useState(value);

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Enter") {
        onChange(localValue);
      } else if (event.key === "Escape") {
        (document.activeElement as HTMLElement | null)?.blur();
      }
      if (props.onKeyDown) {
        return props.onKeyDown(event);
      }
    },
    [onChange, props.onKeyDown, localValue],
  );

  useEffect(() => {
    setLocalValue(value);
  }, [value]);

  const validationError = validate != null ? validate(localValue) : null;
  const status = validationError != null ? "error" : undefined;

  return (
    <FastTooltip title={validationError} placement="left" variant="warning">
      <Input
        value={localValue}
        onBlur={(event) => {
          if (onBlur) onBlur(event);
          onChange(localValue);
        }}
        onChange={(event) => {
          setLocalValue(event.currentTarget.value);
        }}
        onKeyDown={onKeyDown}
        status={status}
        {...props}
      />
    </FastTooltip>
  );
}
