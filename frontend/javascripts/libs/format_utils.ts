import { presetPalettes } from "@ant-design/colors";
import dayjs from "dayjs";
import calendar from "dayjs/plugin/calendar";
import customParseFormat from "dayjs/plugin/customParseFormat";
import duration from "dayjs/plugin/duration";
import localeData from "dayjs/plugin/localeData";
import localizedFormat from "dayjs/plugin/localizedFormat";
import relativeTime from "dayjs/plugin/relativeTime";
import updateLocale from "dayjs/plugin/updateLocale";
import utc from "dayjs/plugin/utc";
import weekday from "dayjs/plugin/weekday";
import * as Utils from "libs/utils";
import _ from "lodash";
import { LongUnitToShortUnitMap, UnitShort, type Vector3, type Vector6 } from "oxalis/constants";
import { Unicode } from "oxalis/constants";

import type { Duration } from "dayjs/plugin/duration";
import type { BoundingBoxObject } from "oxalis/store";
import type { VoxelSize, WkLibsNdBoundingBox } from "types/api_flow_types";

dayjs.extend(updateLocale);
dayjs.extend(duration);
dayjs.extend(relativeTime);
dayjs.extend(utc);
dayjs.extend(calendar);
dayjs.extend(weekday);
dayjs.extend(customParseFormat);
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

export const UnitsMap: Record<UnitShort, number> = {
  ym: 1e-15,
  zm: 1e-12,
  am: 1e-9,
  fm: 1e-6,
  pm: 1e-3,
  nm: 1.0,
  µm: 1e3,
  mm: 1e6,
  cm: 1e7,
  dm: 1e8,
  m: 1e9,
  hm: 1e11,
  km: 1e12,
  Mm: 1e15,
  Gm: 1e18,
  Tm: 1e21,
  Pm: 1e24,
  Em: 1e27,
  Zm: 1e30,
  Ym: 1e33,
  Å: 0.1,
  in: 25400000.0,
  ft: 304800000.0,
  yd: 914400000.0,
  mi: 1609344000000.0,
  pc: 3.085677581e25,
};

const uncommonUnitsToCommon: Map<UnitShort, UnitShort> = new Map([
  [UnitShort.cm, UnitShort.mm],
  [UnitShort.dm, UnitShort.mm],
  [UnitShort.hm, UnitShort.m],
  [UnitShort.Å, UnitShort.pm],
  [UnitShort.in, UnitShort.mm],
  [UnitShort.ft, UnitShort.mm],
  [UnitShort.yd, UnitShort.mm],
  [UnitShort.mi, UnitShort.km],
  [UnitShort.pc, UnitShort.Pm],
]);

function getFactorToNextSmallestCommonUnit(
  unit: UnitShort,
  dimensionsCount: number = 1,
): [number, UnitShort] {
  const commonUnit = uncommonUnitsToCommon.get(unit);
  if (commonUnit == null) {
    return [1, unit];
  }
  const conversionFactor = (UnitsMap[unit] / UnitsMap[commonUnit]) ** dimensionsCount;
  return [conversionFactor, commonUnit];
}

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
export function formatScale(scale: VoxelSize | null | undefined, roundTo: number = 2): string {
  if (scale == null) {
    return "";
  }
  const scaleFactor = scale.factor;
  const smallestScaleFactor = Math.min(...scaleFactor);
  const unitDimension = { unit: LongUnitToShortUnitMap[scale.unit], dimension: 1 };
  const [conversionFactor, newUnit] = findBestUnitForFormatting(
    smallestScaleFactor,
    unitDimension,
    nmFactorToUnit,
    false,
    roundTo,
  );
  const scaleInNmRounded = Utils.map3(
    (value) => Utils.roundTo(value / conversionFactor, roundTo),
    scaleFactor,
  );
  return `${scaleInNmRounded.join(ThinSpace + MultiplicationSymbol + ThinSpace)} ${newUnit}³/voxel`;
}

function toOptionalFixed(num: number, decimalPrecision: number): string {
  const roundedValue = Number.parseFloat(num.toFixed(decimalPrecision));
  const isInt = roundedValue % 1 === 0;
  return isInt ? roundedValue.toFixed(Math.min(decimalPrecision, 1)) : roundedValue.toString();
}

function formatNumberInUnit(
  number: number,
  unitDimension: UnitDimension,
  unitMap: Map<number, string>,
  preferShorterDecimals: boolean = false,
  decimalPrecision: number = 1,
): string {
  let maybeAdjustedUnit;
  let valueInUnit = number;
  if (number === 0) {
    maybeAdjustedUnit = adjustUnitToDimension(unitDimension.unit, unitDimension.dimension);
  } else {
    const [conversionFactor, newUnit] = findBestUnitForFormatting(
      number,
      unitDimension,
      unitMap,
      preferShorterDecimals,
      decimalPrecision,
    );

    valueInUnit = number / conversionFactor;
    maybeAdjustedUnit = newUnit;
  }
  return `${toOptionalFixed(valueInUnit, decimalPrecision)}${ThinSpace}${maybeAdjustedUnit}`;
}

export const nmFactorToUnit = new Map([
  [1e-15, "ym"],
  [1e-12, "zm"],
  [1e-9, "am"],
  [1e-6, "fm"],
  [1e-3, "pm"],
  [1, "nm"],
  [1e3, "µm"],
  [1e6, "mm"],
  [1e7, "cm"],
  [1e9, "m"],
  [1e12, "km"],
  [1e15, "Mm"],
  [1e18, "Gm"],
  [1e21, "Tm"],
  [1e24, "Pm"],
  [1e27, "Em"],
  [1e30, "Zm"],
  [1e33, "Ym"],
]);

// Accepts a length that is interpreted in the given unit and returns a string
// that uses a readable unit to represent the length.
// E.g. formatNumberToLength(0.003, Unit.m) == "3.0 mm"
export function formatNumberToLength(
  length: number,
  unit: UnitShort,
  decimalPrecision: number = 1,
  preferShorterDecimals: boolean = false,
): string {
  const unitDimension = { unit, dimension: 1 };
  return formatNumberInUnit(
    length,
    unitDimension,
    nmFactorToUnit,
    preferShorterDecimals,
    decimalPrecision,
  );
}

export const nmFactorToUnit2D = new Map([
  [1e-30, "ym²"],
  [1e-24, "zm²"],
  [1e-18, "am²"],
  [1e-12, "fm²"],
  [1e-6, "pm²"],
  [1, "nm²"],
  [1e6, "µm²"],
  [1e12, "mm²"],
  [1e14, "cm²"],
  [1e18, "m²"],
  [1e24, "km²"],
  [1e30, "Mm²"],
  [1e36, "Gm²"],
  [1e42, "Tm²"],
  [1e48, "Pm²"],
  [1e54, "Em²"],
  [1e60, "Zm²"],
  [1e66, "Ym²"],
]);

// Accepts an area that is interpreted in the given unit and returns a string
// that uses a readable unit to represent the area.
// E.g. formatNumberToArea(0.003, Unit.m) == "30.0 cm²"
export function formatNumberToArea(
  lengthInUnit2: number,
  unit: UnitShort,
  decimalPrecision: number = 1,
  preferShorterDecimals: boolean = false,
): string {
  const unitDimension = { unit, dimension: 2 };
  return formatNumberInUnit(
    lengthInUnit2,
    unitDimension,
    nmFactorToUnit2D,
    preferShorterDecimals,
    decimalPrecision,
  );
}

export const nmFactorToUnit3D = new Map([
  [1e-45, "ym³"],
  [1e-36, "zm³"],
  [1e-27, "am³"],
  [1e-18, "fm³"],
  [1e-9, "pm³"],
  [1, "nm³"],
  [1e9, "µm³"],
  [1e18, "mm³"],
  [1e21, "cm³"],
  [1e27, "m³"],
  [1e36, "km³"],
  [1e45, "Mm³"],
  [1e54, "Gm³"],
  [1e63, "Tm³"],
  [1e72, "Pm³"],
  [1e81, "Em³"],
  [1e90, "Zm³"],
  [1e99, "Ym³"],
]);

// Accepts an volume that is interpreted in the given unit and returns a string
// that uses a readable unit to represent the volume.
// E.g. formatNumberToVolume(0.003, Unit.m) == "3000.0 cm³"
export function formatNumberToVolume(
  lengthInUnit3: number,
  unit: UnitShort,
  decimalPrecision: number = 1,
  preferShorterDecimals: boolean = false,
): string {
  const unitDimension = { unit, dimension: 3 };
  return formatNumberInUnit(
    lengthInUnit3,
    unitDimension,
    nmFactorToUnit3D,
    preferShorterDecimals,
    decimalPrecision,
  );
}

enum ByteUnit {
  B = "B",
  KB = "KB",
  MB = "MB",
  GB = "GB",
  TB = "TB",
}

const byteFactorToUnit: Map<number, ByteUnit> = new Map([
  [1, ByteUnit.B],
  [1e3, ByteUnit.KB],
  [1e6, ByteUnit.MB],
  [1e9, ByteUnit.GB],
  [1e12, ByteUnit.TB],
]);

// Formats a byte count into a readable string.
// E.g. formatCountToDataAmountUnit(40000000000) == "40.0 GB"
export function formatCountToDataAmountUnit(
  count: number,
  preferShorterDecimals: boolean = false,
  decimalPrecision: number = 1,
): string {
  const unitDimension = { unit: ByteUnit.B, dimension: 1 };
  return formatNumberInUnit(
    count,
    unitDimension,
    byteFactorToUnit,
    preferShorterDecimals,
    decimalPrecision,
  );
}

const getSortedFactorsAndUnits = _.memoize((unitMap: Map<number, string>) =>
  Array.from(unitMap.entries()).sort((a, b) => a[0] - b[0]),
);

// This tuple represents the unit and the dimension the unit is in.
type UnitDimension = { unit: UnitShort | ByteUnit; dimension: number };

function adjustUnitToDimension(unit: UnitShort | ByteUnit, dimension: number): string {
  return dimension === 1 ? unit : dimension === 2 ? `${unit}²` : `${unit}³`;
}

function findBestUnitForFormatting(
  number: number,
  { unit, dimension }: UnitDimension,
  unitMap: Map<number, string>,
  preferShorterDecimals: boolean = false,
  decimalPrecision: number = 1,
): [number, string] {
  const isLengthUnit = unit in UnitsMap;
  let factorToNextSmallestCommonUnit = 1;
  if (isLengthUnit) {
    // In case of a length unit, ensure it is among the common length units that we support conversion for.
    [factorToNextSmallestCommonUnit, unit] = getFactorToNextSmallestCommonUnit(
      unit as UnitShort,
      dimension,
    );
  }
  const adjustedUnit = adjustUnitToDimension(unit, dimension);
  const sortedFactorsAndUnits = getSortedFactorsAndUnits(unitMap);
  const currentFactor =
    sortedFactorsAndUnits.find((entry) => entry[1] === adjustedUnit)?.[0] || undefined;
  if (currentFactor == null) {
    throw new Error(`Couldn't look up appropriate unit for ${adjustedUnit}.`);
  }
  const currentFactorFromSmallestCommonUnit = currentFactor * factorToNextSmallestCommonUnit;
  let closestConversionFactor = sortedFactorsAndUnits[0][0] / currentFactorFromSmallestCommonUnit; // The default is 1 as in this case there is no conversion.
  let closestUnit = sortedFactorsAndUnits[0][1];

  const minimumToRoundUpToOne = 0.95;
  for (const [factor, unit] of sortedFactorsAndUnits) {
    const currentConversionFactor = factor / currentFactorFromSmallestCommonUnit;
    if (
      number >=
      currentConversionFactor *
        (preferShorterDecimals ? minimumToRoundUpToOne * 10 ** -decimalPrecision : 1)
    ) {
      closestConversionFactor = currentConversionFactor;
      closestUnit = unit;
    }
  }
  return [closestConversionFactor, closestUnit];
}
export function formatLengthAsVx(lengthInVx: number, roundTo: number = 2): string {
  const roundedLength = Utils.roundTo(lengthInVx, roundTo);
  return `${roundedLength} vx`;
}
export function formatAreaAsVx(areaInVx: number, roundTo: number = 2): string {
  return `${formatLengthAsVx(areaInVx, roundTo)}²`;
}
export function formatExtentInUnitWithLength(
  extent: BoundingBoxObject,
  formattingFunction: (length: number) => string,
): string {
  return [
    formattingFunction(extent.width),
    formattingFunction(extent.height),
    formattingFunction(extent.depth),
  ].join(`${ThinSpace}×${ThinSpace}`);
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

export function formatDurationToSeconds(durationInMillisecons: number) {
  const duration = dayjs.duration(durationInMillisecons);
  return duration.format("s");
}

export function formatHash(id: string): string {
  return id.slice(-6);
}

export function formatDateMedium(date: Date | number): string {
  return dayjs(date).format("lll");
}
export function formatTimeInterval(start: Date | number, end: Date | number): string {
  return dayjs.duration(dayjs(start).diff(dayjs(end))).humanize(true);
}
export function formatTimeIntervalStrict(start: Date | number, end: Date | number): string {
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

export function formatVoxels(voxelCount: number) {
  if (voxelCount == null) {
    return "";
  }
  if (!Number.isFinite(voxelCount)) {
    return "Infinity";
  }
  if (voxelCount > 2 ** 50) {
    return `${(voxelCount / 2 ** 50).toPrecision(4)} PVx`;
  }
  if (voxelCount > 2 ** 40) {
    return `${(voxelCount / 2 ** 40).toPrecision(4)} TVx`;
  }
  if (voxelCount > 2 ** 30) {
    return `${(voxelCount / 2 ** 30).toPrecision(4)} GVx`;
  }
  if (voxelCount > 2 ** 20) {
    return `${(voxelCount / 2 ** 20).toPrecision(4)} MVx`;
  }
  if (voxelCount > 2 ** 10) {
    return `${(voxelCount / 2 ** 10).toPrecision(4)} KVx`;
  }
  return `${voxelCount} B`;
}

export function formatNumber(num: number): string {
  return new Intl.NumberFormat("en-US").format(num);
}

export function formatWkLibsNdBBox(ndBBox: WkLibsNdBoundingBox): string {
  let bboxString = ndBBox.topLeft.join(", ");
  bboxString += ` ${ndBBox.width}, ${ndBBox.height}, ${ndBBox.depth}`;
  let additionalAxisStrings = ndBBox.additionalAxes.map((axis) => {
    const boundsString =
      axis.bounds[1] - 1 > axis.bounds[0]
        ? `${axis.bounds[0]}-${axis.bounds[1]}`
        : `${axis.bounds[0]}`;
    return `${axis.name}=${boundsString}`;
  });
  return additionalAxisStrings.length > 0
    ? `${bboxString} (${additionalAxisStrings.join(", ")})`
    : bboxString;
}

export function formatCreditsString(credits: string): string {
  return credits
    .replace(/(\.\d*?[1-9])0+$/g, "$1") // Remove trailing zeros after decimal
    .replace(/\.0*$/g, ""); // Remove the decimal point if no digits remain
}
