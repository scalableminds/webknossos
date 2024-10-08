import dayjs from "dayjs";
import FastTooltip from "./fast_tooltip";

const defaultTimeFormat = "YYYY-MM-DD HH:mm";

/**
 * Return current date and time. Please only use this function if you need
 * a pure string representation. In all other cases, please prefer the
 * <FormattedDate /> component below.
 */
export function formatDateInLocalTimeZone(
  date: number = Date.now(),
  format: string | null | undefined = null,
): string {
  format = format || defaultTimeFormat;
  return dayjs(date).format(format);
}

export default function FormattedDate({
  timestamp,
  format,
  tooltipFormat,
}: {
  timestamp: string | number | Date;
  format?: string;
  tooltipFormat?: string;
}) {
  const _timestamp = dayjs.utc(timestamp);

  const _format = format || defaultTimeFormat;
  const _tooltipFormat = tooltipFormat || format;

  return (
    <FastTooltip
      title={`The displayed time refers to your local timezone. In UTC, the time is: ${_timestamp.format(
        _tooltipFormat,
      )}`}
    >
      {_timestamp.local().format(_format)}
    </FastTooltip>
  );
}
