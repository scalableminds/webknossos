import { Dropdown, Radio } from "antd";
import type { MenuItemType } from "antd/es/menu/interface";
import FastTooltip from "components/fast_tooltip";

import { document } from "libs/window";
import type React from "react";
import { useDispatch } from "react-redux";
import { AnnotationTool, type AnnotationToolId } from "viewer/model/accessors/tool_accessor";
import { setToolAction } from "viewer/model/actions/ui_actions";

export const ACTIONBAR_MARGIN_LEFT = "var(--ant-margin-xs)"; // keep in sync with stylesheets/trace_view/_action_bar.less
export const NARROW_BUTTON_STYLE = {
  paddingLeft: "var(--ant-margin-xs)",
  paddingRight: "var(--ant-margin-xs)",
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
  title: string | null;
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
        <div style={{ ...NARROW_BUTTON_STYLE, display: "block" }}>{children}</div>
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
  description?: string;
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
      title={description != null ? `${name} – ${description}` : null}
      disabledTitle={`${name} – ${disabledExplanation}`}
      onMouseEnter={onMouseEnter}
      {...props}
    />
  );
}

export function ToolRadioButtonWithDropdown({
  disabled,
  onClick,
  children,
  onMouseEnter,
  dropdownItems,
  disabledExplanation,
  ...props
}: {
  disabled?: boolean;
  children: React.ReactNode;
  style?: React.CSSProperties;
  value: unknown;
  onClick?: (event: React.MouseEvent) => void;
  dropdownItems: MenuItemType[];
  onMouseEnter?: () => void;
  disabledExplanation?: string;
}) {
  const dispatch = useDispatch();
  // See explanation for RadioButtonWithTooltip: Add dropdown/tooltip into the button and tweak
  // padding so that it is triggered when hovering anywhere within the button, not just the icon.
  const innerContent = disabled ? (
    <FastTooltip title={disabledExplanation}>
      <div style={{ ...NARROW_BUTTON_STYLE, display: "block" }}>{children}</div>
    </FastTooltip>
  ) : (
    <Dropdown
      menu={{
        items: dropdownItems,
        onClick: (key) => dispatch(setToolAction(AnnotationTool[key.key as AnnotationToolId])),
      }}
      trigger={["hover"]}
    >
      <div style={{ ...NARROW_BUTTON_STYLE, display: "block" }}>{children}</div>
    </Dropdown>
  );
  return (
    <Radio.Button
      disabled={disabled}
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
      {innerContent}
    </Radio.Button>
  );
}
