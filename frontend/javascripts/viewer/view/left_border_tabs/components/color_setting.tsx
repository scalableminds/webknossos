import { hexToRgb } from "libs/colors";
import { useCallback, useEffect, useRef } from "react";
import type { Vector3 } from "viewer/constants";

type ColorSettingPropTypes = {
  value: string;
  onChange: (value: Vector3) => void;
  // Called when the native color picker is opened or closed.
  onPickerOpenChange?: (isOpen: boolean) => void;
  disabled?: boolean;
  style?: Record<string, any>;
};

export default function ColorSetting(props: ColorSettingPropTypes) {
  const { value, disabled = false, style, onPickerOpenChange } = props;
  const inputRef = useRef<HTMLInputElement>(null);
  const isPickerOpenRef = useRef(false);
  const onPickerOpenChangeRef = useRef(onPickerOpenChange);
  onPickerOpenChangeRef.current = onPickerOpenChange;

  const setIsPickerOpen = useCallback((isOpen: boolean) => {
    if (isPickerOpenRef.current === isOpen) return;
    isPickerOpenRef.current = isOpen;
    onPickerOpenChangeRef.current?.(isOpen);
  }, []);

  useEffect(() => {
    const input = inputRef.current;
    if (input == null) return;
    // React's onChange fires for every intermediate color (native "input" event). The native
    // "change" event only fires once the picker is closed with a new color.
    const onNativeChange = () => setIsPickerOpen(false);
    input.addEventListener("change", onNativeChange);
    return () => {
      input.removeEventListener("change", onNativeChange);
      setIsPickerOpen(false);
    };
  }, [setIsPickerOpen]);

  const onColorChange = (evt: React.ChangeEvent<HTMLInputElement>) => {
    props.onChange(hexToRgb(evt.target.value));
  };

  const onBlur = () => {
    // Some platforms open the picker as a separate window, which blurs the input while the
    // picker is still open. Only treat the blur as closing if the page kept the focus.
    setTimeout(() => {
      if (document.hasFocus() && document.activeElement !== inputRef.current) {
        setIsPickerOpen(false);
      }
    }, 0);
  };

  const onFocus = () => {
    // The input regains focus when a separate picker window is closed (e.g. cancelled).
    setIsPickerOpen(false);
  };

  return (
    <div
      className="color-display-wrapper"
      style={{
        backgroundColor: value,
        ...style,
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <input
        ref={inputRef}
        type="color"
        style={{
          opacity: 0,
          display: "block",
          border: "none",
          cursor: disabled ? "not-allowed" : "pointer",
          width: "100%",
          height: "100%",
        }}
        onClick={() => setIsPickerOpen(true)}
        onFocus={onFocus}
        onBlur={onBlur}
        onChange={onColorChange}
        value={value}
        disabled={disabled}
      />
    </div>
  );
}
