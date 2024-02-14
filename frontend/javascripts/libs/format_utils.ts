import { presetPalettes } from "@ant-design/colors";
import type { Vector3, Vector6 } from "oxalis/constants";
import { Unicode } from "oxalis/constants";
import * as Utils from "libs/utils";
import _ from "lodash";
import dayjs from "dayjs";
import duration from "dayjs/plugin/duration";
import updateLocale from "dayjs/plugin/updateLocale";
import relativeTime from "dayjs/plugin/relativeTime";
import localizedFormat from "dayjs/plugin/localizedFormat";
import calendar from "dayjs/plugin/calendar";
import utc from "dayjs/plugin/utc";
import weekday from "dayjs/plugin/weekday";
import localeData from "dayjs/plugin/localeData";

import type { BoundingBoxObject } from "oxalis/store";
import type { Duration } from "dayjs/plugin/duration";

dayjs.extend(updateLocale);
dayjs.extend(duration);
dayjs.extend(relativeTime);
dayjs.extend(utc);
dayjs.extend(calendar);
dayjs.extend(weekday);
dayjs.extend(localeData);
dayjs.extend(localizedFormat);
dayjs.updateLocale("en", {
  weekStart: 1,
  calendar: {
    sameDay: "[Today]",
    nextDay: "[Tomorrow]",
    nextWeek: "dddd",
    lastDay: "[Yesterday]",
    lastWeek: "[Last] dddd (YYYY-MM-DD)",
    sameElse: "YYYY-MM-DD",
  },
});

const { ThinSpace, MultiplicationSymbol } = Unicode;
const COLOR_MAP: Array<string> = [
  "#575AFF",
  "#8086FF",
  "#2A0FC6",
  "#40bfd2",
  "#b92779",
  "#FF7BA6",
  "#FF9364",
  "#750790",
];
// Specifying a preset color makes an antd <Tag/> appear more lightweight, see https://ant.design/components/tag/
const COLOR_MAP_ANTD: Array<string> = Object.keys(presetPalettes);
export function stringToColor(string: string): string {
  const hash = hashString(string, COLOR_MAP.length);
  return COLOR_MAP[hash];
}
export function stringToAntdColorPreset(string: string): string {
  const hash = hashString(string, COLOR_MAP_ANTD.length);
  return COLOR_MAP_ANTD[hash];
}
export function stringToAntdColorPresetRgb(string: string): Vector3 {
  const presetString = stringToAntdColorPreset(string);
  // This will be a hex code, see https://www.npmjs.com/package/@ant-design/colors
  // @ts-expect-error ts-migrate(2345) FIXME: Argument of type 'string | undefined' is not assig... Remove this comment to see the full error message
  return Utils.hexToRgb(presetPalettes[presetString].primary);
}

function hashString(string: string, max: number): number {
  let hash = 0;

  for (let i = 0; i < string.length; i++) {
    hash += string.charCodeAt(i);
  }

  return hash % max;
}

export function formatTuple(tuple: (Array<number> | Vector3 | Vector6) | null | undefined) {
  if (tuple != null && tuple.length > 0) {
    const tupleRounded = tuple.map((value) => Utils.roundTo(value, 2));
    return `(${tupleRounded.join(", ")})`;
  } else {
    return "";
  }
}
export function formatScale(scaleArr: Vector3 | null | undefined, roundTo: number = 2): string {
  if (scaleArr != null && scaleArr.length > 0) {
    let unit = "nm³";
    let scaleArrAdjusted = scaleArr;
    const smallestValue = Math.min(...scaleArr);

    if (smallestValue > 1000000) {
      // @ts-expect-error ts-migrate(2322) FIXME: Type 'number[]' is not assignable to type 'Vector3... Remove this comment to see the full error message
      scaleArrAdjusted = scaleArr.map((value) => value / 1000000);
      unit = "mm³";
    } else if (smallestValue > 1000) {
      // @ts-expect-error ts-migrate(2322) FIXME: Type 'number[]' is not assignable to type 'Vector3... Remove this comment to see the full error message
      scaleArrAdjusted = scaleArr.map((value) => value / 1000);
      unit = "µm³";
    }

    const scaleArrRounded = scaleArrAdjusted.map((value) => Utils.roundTo(value, roundTo));
    return `${scaleArrRounded.join(ThinSpace + MultiplicationSymbol + ThinSpace)} ${unit}/voxel`;
  } else {
    return "";
  }
}

export function formatNumberToUnit(
  number: number,
  unitMap: Map<number, string>,
  preferShorterDecimals: boolean = false,
  decimalPrecision: number = 1,
): string {
  const closestFactor = findClosestToUnitFactor(
    number,
    unitMap,
    preferShorterDecimals,
    decimalPrecision,
  );
  const unit = unitMap.get(closestFactor);

  if (unit == null) {
    throw new Error("Couldn't look up appropriate unit.");
  }

  const valueInUnit = number / closestFactor;

  if (valueInUnit !== Math.floor(valueInUnit)) {
    return `${valueInUnit.toFixed(decimalPrecision)}${ThinSpace}${unit}`;
  }

  return `${valueInUnit}${ThinSpace}${unit}`;
}

const nmFactorToUnit = new Map([
  [1e-3, "pm"],
  [1, "nm"],
  [1e3, "µm"],
  [1e6, "mm"],
  [1e9, "m"],
  [1e12, "km"],
]);
export function formatNumberToLength(lengthInNm: number, decimalPrecision: number = 1): string {
  return formatNumberToUnit(lengthInNm, nmFactorToUnit, true, decimalPrecision);
}

const nmFactorToUnit2D = new Map([
  [1e-6, "pm²"],
  [1, "nm²"],
  [1e6, "µm²"],
  [1e12, "mm²"],
  [1e18, "m²"],
  [1e24, "km²"],
]);

export function formatNumberToArea(lengthInNm2: number, decimalPrecision: number = 1): string {
  return formatNumberToUnit(lengthInNm2, nmFactorToUnit2D, true, decimalPrecision);
}

const nmFactorToUnit3D = new Map([
  [1e-9, "pm³"],
  [1, "nm³"],
  [1e9, "µm³"],
  [1e18, "mm³"],
  [1e27, "m³"],
  [1e36, "km³"],
]);
export function formatNumberToVolume(lengthInNm3: number, decimalPrecision: number = 1): string {
  return formatNumberToUnit(lengthInNm3, nmFactorToUnit3D, true, decimalPrecision);
}

const byteFactorToUnit = new Map([
  [1, "B"],
  [1e3, "KB"],
  [1e6, "MB"],
  [1e9, "GB"],
  [1e12, "TB"],
]);
export function formatCountToDataAmountUnit(
  count: number,
  preferShorterDecimals: boolean = false,
  decimalPrecision: number = 1,
): string {
  return formatNumberToUnit(count, byteFactorToUnit, preferShorterDecimals, decimalPrecision);
}

const getSortedFactors = _.memoize((unitMap: Map<number, string>) =>
  Array.from(unitMap.keys()).sort((a, b) => a - b),
);

export function findClosestToUnitFactor(
  number: number,
  unitMap: Map<number, string>,
  preferShorterDecimals: boolean = false,
  decimalPrecision: number = 1,
): number {
  const sortedFactors = getSortedFactors(unitMap);
  let closestFactor = sortedFactors[0];
  const minumumToRoundUpToOne = 0.95;

  for (const factor of sortedFactors) {
    if (
      number >=
      factor * (preferShorterDecimals ? minumumToRoundUpToOne * 10 ** -decimalPrecision : 1)
    ) {
      closestFactor = factor;
    }
  }
  return closestFactor;
}
export function formatLengthAsVx(lengthInVx: number, roundTo: number = 2): string {
  const roundedLength = Utils.roundTo(lengthInVx, roundTo);
  return `${roundedLength} vx`;
}
export function formatAreaAsVx(areaInVx: number, roundTo: number = 2): string {
  return `${formatLengthAsVx(areaInVx, roundTo)}²`;
}
export function formatExtentWithLength(
  extent: BoundingBoxObject,
  formattingFunction: (arg0: number) => string,
): string {
  return `${formattingFunction(extent.width)}${ThinSpace}×${ThinSpace}${formattingFunction(
    extent.height,
  )}${ThinSpace}×${ThinSpace}${formattingFunction(extent.depth)}`;
}
export function formatMilliseconds(durationMilliSeconds: number): string {
  return formatSeconds(durationMilliSeconds / 1000);
}
export function formatSeconds(durationSeconds: number): string {
  const t = dayjs.duration(durationSeconds, "seconds");
  const [days, hours, minutes, seconds] = [t.days(), t.hours(), t.minutes(), t.seconds()];
  let timeString;

  if (days === 0 && hours === 0 && minutes === 0) {
    timeString = `${seconds}s`;
  } else if (days === 0 && hours === 0) {
    timeString = `${minutes}m ${seconds}s`;
  } else if (days === 0) {
    timeString = `${hours}h ${minutes}m ${seconds}s`;
  } else {
    timeString = `${days}d ${hours}h ${minutes}m ${seconds}s`;
  }

  return timeString;
}
export function formatDurationToMinutesAndSeconds(durationInMillisecons: number) {
  const duration = dayjs.duration(durationInMillisecons);
  return duration.format("mm:ss");
}
export function formatHash(id: string): string {
  return id.slice(-6);
}

export function formatDateMedium(date: Date | number): string {
  return dayjs(date).format("lll");
}
export function formatDistance(start: Date | number, end: Date | number): string {
  return dayjs.duration(dayjs(start).diff(dayjs(end))).humanize(true);
}
export function formatDistanceStrict(start: Date | number, end: Date | number): string {
  const duration = dayjs.duration(dayjs(start).diff(dayjs(end)));
  return formatDurationStrict(duration);
}
export function formatDurationStrict(duration: Duration): string {
  const parts: Array<string> = [];
  if (Math.floor(duration.asDays()) > 0) {
    parts.push(`${formatNumber(Math.floor(duration.asDays()))}d`);
  }
  if (duration.hours() > 0) {
    parts.push(`${duration.hours()}h`);
  }
  if (duration.minutes() > 0) {
    parts.push(`${duration.minutes()}m`);
  }
  if (duration.seconds() > 0) {
    parts.push(`${duration.seconds()}s`);
  }
  if (duration.asSeconds() < 1) {
    parts.push("0s");
  }
  return parts.join(" ");
}

export function formatCPU(cpuShare: number) {
  if (cpuShare == null || !Number.isFinite(cpuShare)) {
    return "";
  }
  return `${(cpuShare * 100).toFixed(0)}%`;
}

export function formatBytes(nbytes: number) {
  if (nbytes == null || !Number.isFinite(nbytes)) {
    return "";
  }
  if (nbytes > 2 ** 50) {
    // Pebibyte
    return `${(nbytes / 2 ** 50).toPrecision(4)} PiB`;
  }
  if (nbytes > 2 ** 40) {
    // Tebibyte
    return `${(nbytes / 2 ** 40).toPrecision(4)} TiB`;
  }
  if (nbytes > 2 ** 30) {
    // Gibibyte
    return `${(nbytes / 2 ** 30).toPrecision(4)} GiB`;
  }
  if (nbytes > 2 ** 20) {
    // Mebibyte
    return `${(nbytes / 2 ** 20).toPrecision(4)} MiB`;
  }
  if (nbytes > 2 ** 10) {
    // Kibibyte
    return `${(nbytes / 2 ** 10).toPrecision(4)} KiB`;
  }
  return `${nbytes} B`;
}

export function formatNumber(num: number): string {
  return new Intl.NumberFormat("en-US").format(num);
}
