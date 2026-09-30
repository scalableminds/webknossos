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

function toLocalDate(timestamp: string | number | Date): dayjs.Dayjs {
  return dayjs.utc(timestamp).local();
}

export function isToday(timestamp: string | number | Date): boolean {
  return toLocalDate(timestamp).isSame(dayjs(), "day");
}

function formatHumanReadable(
  localDate: dayjs.Dayjs,
  dateOnly: boolean,
  includeTodayLabel: boolean,
): string {
  if (dateOnly) {
    return localDate.format("D MMMM YYYY");
  }

  const now = dayjs();
  const todayStart = now.startOf("day");

  if (localDate.isAfter(now)) {
    return localDate.format("D MMMM YYYY HH:mm");
  }

  if (localDate.isSame(todayStart, "day")) {
    return localDate.format(includeTodayLabel ? "[today] HH:mm" : "HH:mm");
  }

  if (localDate.isAfter(todayStart.subtract(7, "day"), "day")) {
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
  includeTodayLabel = false,
}: {
  timestamp: string | number | Date;
  format?: string;
  dateOnly?: boolean;
  // Prefixes times of today with "today" (e.g. "today 13:01" instead of "13:01").
  includeTodayLabel?: boolean;
}) {
  const localDate = toLocalDate(timestamp);
  const tzString = formatTimezoneOffset(localDate.utcOffset());
  const tooltipText = localDate.format(`YYYY-MM-DD HH:mm:ss (${tzString})`);
  const displayText = format
    ? localDate.format(format)
    : formatHumanReadable(localDate, dateOnly ?? false, includeTodayLabel);

  return (
    <span onClick={() => copyToClipboard(tooltipText, "date", true)}>
      <FastTooltip title={tooltipText}>{displayText}</FastTooltip>
    </span>
  );
}
