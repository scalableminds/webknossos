import type Icon from "@ant-design/icons";
import { ThemedIcon } from "components/themed_icon";
import type React from "react";

interface KeyboardKeyIconProps extends React.ComponentProps<typeof Icon> {
  label: string; // e.g. "CTRL", "I",
}

/**
 * Renders a keyboard key icon with a centered text label. Use it to visually explain keyboard shortcuts
 */
export function KeyboardKeyIcon({ label, style, ...props }: KeyboardKeyIconProps) {
  return (
    <span
      style={{
        position: "relative",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <ThemedIcon name="icon-keyboard-key" style={{ fontSize: "2em", ...style }} {...props} />
      <span
        style={{
          position: "absolute",
          fontWeight: "bold",
          userSelect: "none",
          pointerEvents: "none",
          color: "var(--ant-color-primary)",
        }}
      >
        {label}
      </span>
    </span>
  );
}
