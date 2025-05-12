import { Radio } from "antd";
import type React from "react";

import { document } from "libs/window";

import FastTooltip from "components/fast_tooltip";

export const NARROW_BUTTON_STYLE = {
  paddingLeft: 10,
  paddingRight: 8,
};
export const IMG_STYLE_FOR_SPACEY_ICONS = {
  width: 19,
  height: 19,
  lineHeight: 10,
  marginTop: -2,
  verticalAlign: "middle",
};

export function RadioButtonWithTooltip({
  title,
  disabledTitle,
  disabled,
  onClick,
  children,
  onMouseEnter,
  ...props
}: {
  title: string;
  disabledTitle?: string;
  disabled?: boolean;
  children: React.ReactNode;
  style?: React.CSSProperties;
  value: unknown;
  onClick?: (event: React.MouseEvent) => void;
  onMouseEnter?: () => void;
}) {
  // FastTooltip adds data-* properties so that the centralized ReactTooltip
  // is hooked up here. Unfortunately, FastTooltip would add another div or span
  // which antd does not like within this toolbar.
  // Therefore, we move the tooltip into the button which requires tweaking the padding
  // a bit (otherwise, the tooltip would only occur when hovering exactly over the icon
  // instead of everywhere within the button).
  return (
    <Radio.Button
      disabled={disabled}
      // Remove the padding here and add it within the tooltip.
      className="no-padding"
      onClick={(event: React.MouseEvent) => {
        if (document.activeElement) {
          (document.activeElement as HTMLElement).blur();
        }
        if (onClick) {
          onClick(event);
        }
      }}
      {...props}
    >
      <FastTooltip title={disabled ? disabledTitle : title} onMouseEnter={onMouseEnter}>
        {/* See comments above. */}
        <span style={{ padding: "0 10px", display: "block" }}>{children}</span>
      </FastTooltip>
    </Radio.Button>
  );
}

export function ToolRadioButton({
  name,
  description,
  disabledExplanation,
  onMouseEnter,
  ...props
}: {
  name: string;
  description: string;
  disabledExplanation?: string;
  disabled?: boolean;
  children: React.ReactNode;
  style?: React.CSSProperties;
  value: unknown;
  onClick?: (event: React.MouseEvent) => void;
  onMouseEnter?: () => void;
}) {
  return (
    <RadioButtonWithTooltip
      title={`${name} – ${description}`}
      disabledTitle={`${name} – ${disabledExplanation}`}
      onMouseEnter={onMouseEnter}
      {...props}
    />
  );
}
