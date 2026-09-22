import { Button } from "antd";
import FastTooltip from "components/fast_tooltip";
import type React from "react";
import { Link } from "react-router";

/**
 * Layout primitives of the info tab.
 *
 * The panel is built from groups (separated by a full-bleed hairline, headed by a grey
 * uppercase label) containing one fact per row. A row puts its label on the left and its
 * value on the right — either at the panel's right edge, or, for values too short to reach
 * it, at a capped track so that the number stays next to its label (`isShortValue`).
 */

export function InfoTabSection({
  label,
  action,
  children,
}: {
  label: string;
  /** A group-level affordance, rendered inline right after the label. */
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="info-tab-section">
      <div className="info-tab-section-header">
        <span className="info-tab-section-label">{label}</span>
        {action}
      </div>
      {children}
    </div>
  );
}

export function InfoTabRow({
  label,
  labelSuffix,
  isShortValue,
  tooltip,
  tooltipHtml,
  tooltipRenderer,
  onClick,
  children,
}: {
  label: string;
  /** e.g. an info icon explaining the label. */
  labelSuffix?: React.ReactNode;
  /** Counts, magnifications and link counts right-align to a capped track instead. */
  isShortValue?: boolean;
  tooltip?: string;
  /** Tooltip content as HTML, for multi-line explanations. */
  tooltipHtml?: string;
  /** Rendered lazily on hover — use it when building the content is expensive. */
  tooltipRenderer?: () => React.ReactElement;
  onClick?: () => void;
  children: React.ReactNode;
}) {
  const row = (
    <div className={`info-tab-row ${isShortValue ? "info-tab-row-short" : ""}`} onClick={onClick}>
      <div className="info-tab-row-label">
        {label}
        {labelSuffix}
      </div>
      <div className="info-tab-row-value">{children}</div>
    </div>
  );

  if (tooltip == null && tooltipHtml == null && tooltipRenderer == null) {
    return row;
  }

  return (
    <FastTooltip
      title={tooltip}
      html={tooltipHtml}
      dynamicRenderer={tooltipRenderer}
      placement="left"
    >
      {row}
    </FastTooltip>
  );
}

/** The unit of a value ("nm", "vx"), muted so that the number itself stays dominant. */
export function InfoTabUnit({ children }: { children: React.ReactNode }) {
  return <span className="info-tab-unit"> {children}</span>;
}

/**
 * An edit affordance for one specific string. It is rendered inline, immediately after its
 * text — never pinned to the panel's right edge, where it would end up far from what it
 * edits on a wide panel. Visible at rest, because discoverability beats cleanliness here.
 */
export function InlineIconButton({
  icon,
  tooltip,
  ariaLabel,
  onClick,
  to,
  isSecondary,
}: {
  icon: React.ReactNode;
  tooltip: string;
  ariaLabel: string;
  onClick?: () => void;
  /** Renders the button as a router link instead of a plain button. */
  to?: string;
  /** Group-level affordances (the dataset cog) are smaller and muted until hovered. */
  isSecondary?: boolean;
}) {
  const button = (
    <Button
      type="text"
      size="small"
      aria-label={ariaLabel}
      onClick={onClick}
      icon={icon}
      className={`info-tab-inline-button ${isSecondary ? "info-tab-inline-button-secondary" : ""}`}
    />
  );

  return (
    <FastTooltip title={tooltip}>{to != null ? <Link to={to}>{button}</Link> : button}</FastTooltip>
  );
}
