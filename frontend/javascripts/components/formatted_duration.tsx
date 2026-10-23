import { type DurationPrecision, formatDuration } from "libs/format_utils";
import { millisecondsToHours } from "libs/utils";
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
  const decimalHours = millisecondsToHours(durationMs).toLocaleString(undefined, {
    maximumFractionDigits: 2,
  });
  const tooltipText = `${formatDuration(durationMs, "seconds")} (${decimalHours} hours)`;

  return <FastTooltip title={tooltipText}>{formatDuration(durationMs, precision)}</FastTooltip>;
}
