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
import memoize from "lodash-es/memoize";
import type { VoxelSize, WkLibsNdBoundingBox } from "types/api_types";
import type { BoundingBoxObject } from "types/bounding_box";
import {
  LongUnitToShortUnitMap,
  Unicode,
  UnitShort,
  type Vector3,
  type Vector6,
} from "viewer/constants";
import { map3, pluralize, roundTo } from "./utils";

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

// String → color helpers (stringToTagColor, stringToAntdColorPreset, …) live in libs/colors.ts.

export function formatTuple(tuple: (Array<number> | Vector3 | Vector6) | null | undefined) {
  if (tuple != null && tuple.length > 0) {
    const tupleRounded = tuple.map((value) => roundTo(value, 2));
    return `(${tupleRounded.join(", ")})`;
  } else {
    return "";
  }
}
function getRoundedScaleValues(
  scale: VoxelSize,
  roundToDigits: number = 2,
): [[number, number, number], string] {
  const scaleFactor = scale.factor;
  const smallestScaleFactor = Math.min(...scaleFactor);
  const unitDimension = { unit: LongUnitToShortUnitMap[scale.unit], dimension: 1 };
  const [conversionFactor, newUnit] = findBestUnitForFormatting(
    smallestScaleFactor,
    unitDimension,
    nmFactorToUnit,
    false,
    roundToDigits,
  );
  const scaleRounded = map3(
    (value) => roundTo(value / conversionFactor, roundToDigits),
    scaleFactor,
  );
  return [scaleRounded, newUnit];
}

export function formatScale(
  scale: VoxelSize | null | undefined,
  roundToDigits: number = 2,
): string {
  if (scale == null) {
    return "";
  }
  const [scaleRounded, newUnit] = getRoundedScaleValues(scale, roundToDigits);
  return `${scaleRounded.join(ThinSpace + MultiplicationSymbol + ThinSpace)} ${newUnit}³/Vx`;
}

/**
 * Splits the voxel size into the rounded edge lengths and their (plain) unit, so that a
 * caller can style the unit differently from the numbers. `formatScale` renders the unit as
 * "nm³/Vx"; here it stays the plain edge-length unit, because the numbers are edge lengths.
 */
export function formatScaleValues(
  scale: VoxelSize | null | undefined,
  roundToDigits: number = 2,
): [string, string] {
  if (scale == null) {
    return ["", ""];
  }
  const [scaleRounded, newUnit] = getRoundedScaleValues(scale, roundToDigits);
  return [scaleRounded.join(ThinSpace + MultiplicationSymbol + ThinSpace), newUnit];
}

export function formatScaleForClipboard(
  scale: VoxelSize | null | undefined,
  roundToDigits: number = 2,
): string {
  if (scale == null) {
    return "";
  }
  const [scaleRounded] = getRoundedScaleValues(scale, roundToDigits);
  return scaleRounded.join(",") + " " + scale.unit;
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

const nmFactorToUnit = new Map([
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

const nmFactorToUnit2D = new Map([
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

const nmFactorToUnit3D = new Map([
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

// Accepts a volume that is interpreted in the given unit and returns a string
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
  // Byte values are always integers, so don't show decimals for them.
  const effectiveDecimalPrecision = count < 1000 ? 0 : decimalPrecision;
  return formatNumberInUnit(
    count,
    unitDimension,
    byteFactorToUnit,
    preferShorterDecimals,
    effectiveDecimalPrecision,
  );
}

const getSortedFactorsAndUnits = memoize((unitMap: Map<number, string>) =>
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
export function formatLengthAsVx(lengthInVx: number, roundToDigits: number = 2): string {
  const roundedLength = roundTo(lengthInVx, roundToDigits);
  return `${roundedLength}${ThinSpace}Vx`;
}
export function formatAreaAsVx(areaInVx: number, roundToDigits: number = 2): string {
  return `${formatLengthAsVx(areaInVx, roundToDigits)}²`;
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
export function formatDateMedium(date: Date | number): string {
  return dayjs(date).format("lll");
}
const MS_PER_SECOND = 1000;
const MS_PER_MINUTE = 60 * MS_PER_SECOND;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;
const MS_PER_DAY = 24 * MS_PER_HOUR;
// Below these thresholds, the remainder is not rounded up to the next unit.
const MINUTE_ROUNDING_THRESHOLD_MS_FOR_RENDERING_MILLIS = 59995;
const MINUTE_ROUNDING_THRESHOLD_MS_FOR_RENDERING_SECONDS = 59499;

/**
 * Formats a duration with a precision that depends on its magnitude, e.g.
 * "400 ms", "1.23 s", "2 m 5 s", "1 h 45 m 10 s" or "3 days 4 h". Seconds are
 * omitted once the duration exceeds a day. This mirrors formatDuration in the
 * backend's Formatter.scala. Please prefer the <FormattedDuration /> component
 * when rendering React elements.
 */
export function formatDuration(durationMs: number): string {
  const sign = durationMs < 0 ? "-" : "";
  let remainingMs = Math.round(Math.abs(durationMs));

  if (remainingMs < MS_PER_SECOND) {
    return `${sign}${remainingMs}${ThinSpace}ms`;
  }
  if (remainingMs < MINUTE_ROUNDING_THRESHOLD_MS_FOR_RENDERING_MILLIS) {
    // Up to two decimals for durations below one minute
    const seconds = Math.round(remainingMs / 10) / 100;
    return `${sign}${seconds}${ThinSpace}s`;
  }

  const parts: Array<string> = [];
  // Round up to the next unit to avoid rendering, e.g., "24 h" or "60 m".
  let days = Math.floor(remainingMs / MS_PER_DAY);
  if (
    remainingMs - days * MS_PER_DAY >
    MS_PER_DAY - MS_PER_MINUTE + MINUTE_ROUNDING_THRESHOLD_MS_FOR_RENDERING_SECONDS
  ) {
    days += 1;
  }
  if (days > 0) {
    parts.push(`${formatNumber(days)} ${pluralize("day", days)}`);
    remainingMs -= days * MS_PER_DAY;
  }

  let hours = Math.floor(remainingMs / MS_PER_HOUR);
  if (
    remainingMs - hours * MS_PER_HOUR >
    MS_PER_HOUR - MS_PER_MINUTE + MINUTE_ROUNDING_THRESHOLD_MS_FOR_RENDERING_SECONDS
  ) {
    hours += 1;
  }
  if (hours > 0) {
    parts.push(`${hours}${ThinSpace}h`);
    remainingMs -= hours * MS_PER_HOUR;
  }

  let minutes = Math.floor(remainingMs / MS_PER_MINUTE);
  if (remainingMs - minutes * MS_PER_MINUTE > MINUTE_ROUNDING_THRESHOLD_MS_FOR_RENDERING_SECONDS) {
    minutes += 1;
  }
  if (minutes > 0) {
    parts.push(`${minutes}${ThinSpace}m`);
    remainingMs -= minutes * MS_PER_MINUTE;
  }

  const seconds = Math.round(remainingMs / MS_PER_SECOND);
  if (days === 0 && seconds > 0) {
    parts.push(`${seconds}${ThinSpace}s`);
  }

  return sign + parts.join(" ");
}
export function formatTimeInterval(begin: Date | number, end: Date | number): string {
  return formatDuration(dayjs(end).diff(dayjs(begin)));
}

export function formatCPU(cpuShare: number) {
  if (cpuShare == null || !Number.isFinite(cpuShare)) {
    return "";
  }
  return `${(cpuShare * 100).toFixed(0)}%`;
}

export function formatBytes(nbytes: number, precision = 0) {
  if (nbytes == null || !Number.isFinite(nbytes)) {
    return "";
  }
  if (nbytes > 2 ** 50) {
    return `${(nbytes / 2 ** 50).toFixed(precision)} PiB`;
  }
  if (nbytes > 2 ** 40) {
    return `${(nbytes / 2 ** 40).toFixed(precision)} TiB`;
  }
  if (nbytes > 2 ** 30) {
    return `${(nbytes / 2 ** 30).toFixed(precision)} GiB`;
  }
  if (nbytes > 2 ** 20) {
    return `${(nbytes / 2 ** 20).toFixed(precision)} MiB`;
  }
  if (nbytes > 2 ** 10) {
    return `${(nbytes / 2 ** 10).toFixed(precision)} KiB`;
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
  if (voxelCount > 10 ** 15) {
    return `${(voxelCount / 10 ** 15).toPrecision(4)} PVx`;
  }
  if (voxelCount > 10 ** 12) {
    return `${(voxelCount / 10 ** 12).toPrecision(4)} TVx`;
  }
  if (voxelCount > 10 ** 9) {
    return `${(voxelCount / 10 ** 9).toPrecision(4)} GVx`;
  }
  if (voxelCount > 10 ** 6) {
    return `${(voxelCount / 10 ** 6).toPrecision(4)} MVx`;
  }
  if (voxelCount > 10 ** 3) {
    return `${(voxelCount / 10 ** 3).toPrecision(4)} KVx`;
  }
  return `${voxelCount} Vx`;
}

export function formatVoxelsForHighNumbers(voxelCount: number) {
  if (voxelCount == null) {
    return "";
  }
  if (!Number.isFinite(voxelCount)) {
    return "Infinity";
  }
  if (voxelCount > 10 ** 15) {
    return `${(voxelCount / 10 ** 15).toPrecision(4)}${ThinSpace}PVx`;
  }
  if (voxelCount > 10 ** 12) {
    return `${(voxelCount / 10 ** 12).toPrecision(4)}${ThinSpace}TVx`;
  }
  if (voxelCount > 10 ** 9) {
    return `${(voxelCount / 10 ** 9).toPrecision(4)}${ThinSpace}GVx`;
  }
  if (voxelCount > 10 ** 6) {
    return `${(voxelCount / 10 ** 6).toPrecision(4)}${ThinSpace}MVx`;
  }
  return `${voxelCount}${ThinSpace}Vx`;
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

// Formats milli credits as credits with up to three decimals and thousands separators,
// e.g. 1234500 -> "1,234.5".
export function formatMilliCreditsString(milliCredits: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 }).format(
    Math.round(milliCredits) / 1000,
  );
}
