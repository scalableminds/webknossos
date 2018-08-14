// @flow
import Utils from "libs/utils";
import type { Vector3, Vector6 } from "oxalis/constants";

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
    return `${scaleArrRounded.join(" × ")} nm³`;
  } else {
    return "";
  }
}
