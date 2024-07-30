import React from "react";

export type FastTooltipPlacement =
  | "top"
  | "top-start"
  | "top-end"
  | "right"
  | "right-start"
  | "right-end"
  | "bottom"
  | "bottom-start"
  | "bottom-end"
  | "left"
  | "left-start"
  | "left-end";

export default function FastTooltip({
  title,
  children,
  placement,
  disabled,
  id,
  onMouseEnter,
  onMouseLeave,
  wrapper,
  html,
}: {
  title?: string | null | undefined;
  children?: React.ReactNode;
  placement?: FastTooltipPlacement;
  disabled?: boolean;
  id?: string;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  wrapper?: "div" | "span" | "p" | "tr"; // Any valid HTML tag, span by default.
  html?: string | null | undefined;
}) {
  const Tag = wrapper || "span";
  return (
    <Tag
      data-tooltip-id={disabled || (title == null && html == null) ? "" : id || "main-tooltip"}
      data-tooltip-content={title}
      data-tooltip-place={placement || "top"}
      data-tooltip-html={html}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      {children}
    </Tag>
  );
}
