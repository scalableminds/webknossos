// @flow
import moment from "moment";

import { Unicode, type Vector3, type Vector6 } from "oxalis/constants";
import * as Utils from "libs/utils";

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

export function formatScale(scaleArr: Vector3): string {
  if (scaleArr != null && scaleArr.length > 0) {
    const scaleArrRounded = scaleArr.map(value => Utils.roundTo(value, 2));
    return `${scaleArrRounded.join(ThinSpace + MultiplicationSymbol + ThinSpace)} nm³`;
  } else {
    return "";
  }
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

export function formatHash(id: string): string {
  return id.slice(-6);
}
