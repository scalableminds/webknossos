// @flow
import { Tooltip } from "antd";
import * as React from "react";
import moment from "moment";

const defaultTimeFormat = "YYYY-MM-DD HH:mm";

/**
 * Return current date and time. Please only use this function if you need
 * a pure string representation. In all other cases, please prefer the
 * <FormattedDate /> component below.
 */
export function formatDateInLocalTimeZone(
  date?: number = Date.now(),
  format?: ?string = null,
): string {
  format = format || defaultTimeFormat;
  return moment(date).format(format);
}

export default function FormattedDate({
  timestamp,
  format,
}: {
  timestamp: string | number | Date,
  format?: string,
}) {
  const _moment = moment.utc(timestamp);
  const _format = format || defaultTimeFormat;
  return (
    <Tooltip
      title={
        <span>
          The displayed time refers to your local timezone. In UTC, the time is:{" "}
          {_moment.format(_format)}
        </span>
      }
    >
      {_moment.local().format(_format)}
    </Tooltip>
  );
}
