import { type DurationPrecision, formatDuration } from "libs/format_utils";
import { millisecondsToHours, pluralize } from "libs/utils";
import FastTooltip from "./fast_tooltip";

/**
 * Renders a duration in the uniform "1 h 45 m" format. The tooltip shows the
 * duration with second precision and in decimal hours.
 * Use formatDuration from libs/format_utils if you need a pure string.
 */
export default function FormattedDuration({
  durationMs,
  precision = "minutes",
}: {
  durationMs: number;
  precision?: DurationPrecision;
}) {
  // Round before pluralizing so that, e.g., 1.001 hours reads as "1 hour".
  const decimalHours = Math.round(millisecondsToHours(durationMs) * 100) / 100;
  const tooltipText = `${formatDuration(durationMs, "seconds")} (${decimalHours.toLocaleString()} ${pluralize("hour", decimalHours)})`;

  return <FastTooltip title={tooltipText}>{formatDuration(durationMs, precision)}</FastTooltip>;
}
