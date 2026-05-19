import dayjs from "dayjs";
import { copyToClipboard } from "libs/clipboard";
import FastTooltip from "./fast_tooltip";

/**
 * Return current date and time. Please only use this function if you need
 * a pure string representation. In all other cases, please prefer the
 * <FormattedDate /> component below.
 */
export function formatDateInLocalTimeZone(
  date: number = Date.now(),
  format: string | null | undefined = null,
): string {
  format = format || "YYYY-MM-DD HH:mm";
  return dayjs(date).format(format);
}

function formatTimezoneOffset(offsetMinutes: number): string {
  const sign = offsetMinutes >= 0 ? "+" : "−";
  const absMinutes = Math.abs(offsetMinutes);
  const hours = Math.floor(absMinutes / 60);
  const minutes = absMinutes % 60;
  if (minutes === 0) {
    return `UTC${sign}${hours}`;
  }
  return `UTC${sign}${hours}:${String(minutes).padStart(2, "0")}`;
}

function formatHumanReadable(localDate: dayjs.Dayjs, dateOnly: boolean): string {
  if (dateOnly) {
    return localDate.format("D MMMM YYYY");
  }

  const now = dayjs();
  const todayStart = now.startOf("day");

  if (localDate.isAfter(now)) {
    return localDate.format("D MMMM YYYY HH:mm");
  }

  if (localDate.isSame(todayStart, "day")) {
    return localDate.format("HH:mm");
  }

  if (localDate.isAfter(todayStart.subtract(6, "day"), "day")) {
    return localDate.format("dddd HH:mm");
  }

  if (localDate.isSame(now, "year")) {
    return localDate.format("D MMMM");
  }

  return localDate.format("D MMMM YYYY");
}

export default function FormattedDate({
  timestamp,
  format,
  dateOnly,
}: {
  timestamp: string | number | Date;
  format?: string;
  dateOnly?: boolean;
}) {
  const localDate = dayjs.utc(timestamp).local();
  const tzString = formatTimezoneOffset(localDate.utcOffset());
  const tooltipText = localDate.format(`YYYY-MM-DD HH:mm:ss (${tzString})`);
  const displayText = format
    ? localDate.format(format)
    : formatHumanReadable(localDate, dateOnly ?? false);

  return (
    <span onClick={() => copyToClipboard(tooltipText, "date", true)}>
      <FastTooltip title={tooltipText}>{displayText}</FastTooltip>
    </span>
  );
}
