import { hexToRgb } from "libs/utils";
import type { Vector3 } from "viewer/constants";

type ColorSettingPropTypes = {
  value: string;
  onChange: (value: Vector3) => void;
  disabled?: boolean;
  style?: Record<string, any>;
};

export default function ColorSetting(props: ColorSettingPropTypes) {
  const { value, disabled = false, style } = props;

  const onColorChange = (evt: React.ChangeEvent<HTMLInputElement>) => {
    props.onChange(hexToRgb(evt.target.value));
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
        type="color"
        style={{
          opacity: 0,
          display: "block",
          border: "none",
          cursor: disabled ? "not-allowed" : "pointer",
          width: "100%",
          height: "100%",
        }}
        onChange={onColorChange}
        value={value}
        disabled={disabled}
      />
    </div>
  );
}
