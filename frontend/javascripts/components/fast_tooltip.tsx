import React from "react";

type Placement =
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
}: {
  title: string | null | undefined;
  children: React.ReactNode;
  placement?: Placement;
  disabled?: boolean;
  id?: string;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  wrapper?: "div" | "span" | "p"; // Any valid HTML tag
}) {
  const Tag = wrapper || "span";
  return (
    <Tag
      data-tooltip-id={disabled || title == null ? "" : id || "main-tooltip"}
      data-tooltip-content={title || ""}
      data-tooltip-place={placement || "top"}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      {children}
    </Tag>
  );
}
