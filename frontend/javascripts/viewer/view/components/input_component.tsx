import { Input, type InputProps, type InputRef } from "antd";
import FastTooltip from "components/fast_tooltip";
import _ from "lodash";
import type React from "react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

/*
 * A lightweight wrapper around <Input> which:
 * - automatically blurs on Escape
 * - fixes cursor-jumping bugs by keeping a local copy of the input's value
 *   within state.currentValue. Without it, editing the name of trees or
 *   comments would always move the cursor to the input's end after each key press.
 *   The fix is inspired by https://github.com/facebook/react/issues/955#issuecomment-281802381
 * - maintains the cursor position / selection even when mutating the input value
 *   while it's focused (mainly necessary when mutating the value on arrow-keypresses)
 */

function InputComponent(props: InputProps) {
  const {
    title,
    style,
    onChange = _.noop,
    onFocus,
    onBlur,
    onKeyDown,
    value = "",
    ...inputProps
  } = props;
  const inputRef = useRef<InputRef>(null);
  const [currentValue, setCurrentValue] = useState(value);

  useEffect(() => {
    setCurrentValue(value);
  }, [value]);

  // This effect handles cursor position/selection when the input value changes
  // while the input is focused.
  useLayoutEffect(() => {
    if (inputRef.current && document.activeElement === inputRef.current.input) {
      // Store current selection
      const selectionStart = inputRef.current.input?.selectionStart;
      const selectionEnd = inputRef.current.input?.selectionEnd;

      // Restore selection after re-render
      if (selectionStart !== null && selectionEnd !== null) {
        inputRef.current.input?.setSelectionRange(selectionStart, selectionEnd);
      }
    }
  }, [currentValue]); // Re-run when currentValue changes

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setCurrentValue(e.target.value);
    if (onChange) {
      onChange(e);
    }
  };

  const handleFocus = (e: React.FocusEvent<HTMLInputElement>) => {
    if (onFocus) {
      onFocus(e);
    }
  };

  const handleBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    if (onBlur) {
      onBlur(e);
    }
  };

  const blurYourself = () => (document.activeElement as HTMLElement | null)?.blur();

  const blurOnEscape = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      blurYourself();
    }
    if (onKeyDown) {
      return onKeyDown(event);
    }
  };

  const input = (
    <Input
      ref={inputRef}
      {...inputProps}
      // Only pass the style to the input if no tooltip container is used.
      // Otherwise, the tooltip container will get the style.
      style={title == null ? style : undefined}
      onChange={handleChange}
      onFocus={handleFocus}
      onBlur={handleBlur}
      value={currentValue}
      onKeyDown={blurOnEscape}
      placeholder={placeholder}
    />
  );

  return title != null ? (
    <FastTooltip style={style} title={title}>
      {input}
    </FastTooltip>
  ) : (
    input
  );
}

export default InputComponent;
