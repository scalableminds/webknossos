import { Input, type InputProps } from "antd";
import type React from "react";
import { useCallback, useEffect, useState } from "react";

export function InputWithUpdateOnBlur({
  value,
  onChange,
  onBlur,
  ...props
}: { value: string; onChange: (value: string) => void } & InputProps) {
  const [localValue, setLocalValue] = useState(value);

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Enter") {
        onChange(localValue);
      } else if (event.key === "Escape") {
        document.activeElement ? (document.activeElement as HTMLElement).blur() : null;
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

  return (
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
      {...props}
    />
  );
}
