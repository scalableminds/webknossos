import { formatDuration } from "libs/format_utils";
import { millisecondsToHours, pluralize } from "libs/utils";
import FastTooltip from "./fast_tooltip";

/**
 * Renders a duration with a magnitude-dependent precision, e.g. "1 h 45 m 10 s"
 * or "3 days 4 h". The tooltip shows the duration in decimal hours.
 * Use formatDuration from libs/format_utils if you need a pure string.
 */
export default function FormattedDuration({ durationMs }: { durationMs: number }) {
  // Round before pluralizing so that, e.g., 1.001 hours reads as "1 hour".
  const decimalHours = Math.round(millisecondsToHours(durationMs) * 100) / 100;
  const tooltipText = `${decimalHours.toLocaleString()} ${pluralize("hour", decimalHours)}`;

  return <FastTooltip title={tooltipText}>{formatDuration(durationMs)}</FastTooltip>;
}
