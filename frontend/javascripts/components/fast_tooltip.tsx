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
}: { title: string; children: React.ReactNode; placement?: Placement; disabled?: boolean }) {
  return (
    <span
      data-tooltip-id={disabled ? "" : "main-tooltip"}
      data-tooltip-content={title}
      data-tooltip-place={placement || "top"}
    >
      {children}
    </span>
  );
}
