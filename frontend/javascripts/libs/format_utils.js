// @flow
import moment from "moment";

import { Unicode, type Vector3, type Vector6 } from "oxalis/constants";
import * as Utils from "libs/utils";
import type { BoundingBoxObject } from "oxalis/store";

const { ThinSpace, MultiplicationSymbol } = Unicode;

const COLOR_MAP: Array<string> = [
  "#6962C5",
  "#403C78",
  "#B2B1C4",
  "#6D6C78",
  "#C4C4C4",
  "#FF5000",
  "#899AC4",
  "#60e0ac",
];

export function stringToColor(role: string): string {
  const hash = hashString(role);
  return COLOR_MAP[hash];
}

function hashString(string: string): number {
  let hash = 0;
  for (let i = 0; i < string.length; i++) {
    hash += string.charCodeAt(i);
  }
  return hash % COLOR_MAP.length;
}

export function formatTuple(tuple: ?(Array<number> | Vector3 | Vector6)) {
  if (tuple != null && tuple.length > 0) {
    const tupleRounded = tuple.map(value => Utils.roundTo(value, 2));
    return `(${tupleRounded.join(", ")})`;
  } else {
    return "";
  }
}

export function formatScale(scaleArr: ?Vector3, roundTo?: number = 2): string {
  if (scaleArr != null && scaleArr.length > 0) {
    let unit = "nm³";
    let scaleArrAdjusted = scaleArr;
    const smallestValue = Math.min(...scaleArr);
    if (smallestValue > 1000000) {
      scaleArrAdjusted = scaleArr.map(value => value / 1000000);
      unit = "mm³";
    } else if (smallestValue > 1000) {
      scaleArrAdjusted = scaleArr.map(value => value / 1000);
      unit = "µm³";
    }
    const scaleArrRounded = scaleArrAdjusted.map(value => Utils.roundTo(value, roundTo));
    return `${scaleArrRounded.join(ThinSpace + MultiplicationSymbol + ThinSpace)} ${unit}/voxel`;
  } else {
    return "";
  }
}

const nmFactorToUnit = new Map([
  [1e-3, "pm"],
  [1, "nm"],
  [1e3, "µm"],
  [1e6, "mm"],
  [1e9, "m"],
  [1e12, "km"],
]);
const sortedNmFactors = Array.from(nmFactorToUnit.keys()).sort((a, b) => a - b);

export function formatNumberToLength(lengthInNm: number): string {
  const closestFactor = findClosestLengthUnitFactor(lengthInNm);
  const unit = nmFactorToUnit.get(closestFactor);
  if (unit == null) {
    throw new Error("Couldn't look up appropriate length unit.");
  }
  const lengthInUnit = lengthInNm / closestFactor;
  if (lengthInUnit !== Math.floor(lengthInUnit)) {
    return `${lengthInUnit.toFixed(1)}${ThinSpace}${unit}`;
  }
  return `${lengthInUnit}${ThinSpace}${unit}`;
}

export function findClosestLengthUnitFactor(lengthInNm: number): number {
  let closestFactor = sortedNmFactors[0];
  for (const factor of sortedNmFactors) {
    if (lengthInNm >= factor) {
      closestFactor = factor;
    }
  }
  return closestFactor;
}

export function formatLengthAsVx(lengthInVx: number, roundTo?: number = 2): string {
  const roundedLength = Utils.roundTo(lengthInVx, roundTo);
  return `${roundedLength} vx`;
}

export function formatExtentWithLength(
  extent: BoundingBoxObject,
  formattingFunction: number => string,
): string {
  return `${formattingFunction(extent.width)}${ThinSpace}×${ThinSpace}${formattingFunction(
    extent.height,
  )}${ThinSpace}×${ThinSpace}${formattingFunction(extent.depth)}`;
}

export function formatMilliseconds(durationMilliSeconds: number): string {
  return formatSeconds(durationMilliSeconds / 1000);
}

export function formatSeconds(durationSeconds: number): string {
  const t = moment.duration(durationSeconds, "seconds");
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
  // Moment does not provide a format method for durations, so we have to do it manually.
  const duration = moment.duration(durationInMillisecons);
  const minuteDuration = duration.minutes() + 60 * duration.hours();
  const minutesAsString = `${minuteDuration < 10 ? 0 : ""}${minuteDuration}`;
  const hoursAsSeconds = `${duration.seconds() < 10 ? 0 : ""}${duration.seconds()}`;
  return `${minutesAsString}:${hoursAsSeconds}`;
}

export function formatHash(id: string): string {
  return id.slice(-6);
}
