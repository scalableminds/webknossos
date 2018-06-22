/*
 * template_helpers.js
 * @flow
 */

import Utils from "libs/utils";
import type { Vector3, Vector6 } from "oxalis/constants";

class TemplateHelpers {
  COLOR_MAP: Array<string> = [
    "#6962C5",
    "#403C78",
    "#B2B1C4",
    "#6D6C78",
    "#C4C4C4",
    "#FF5000",
    "#899AC4",
    "#60e0ac",
  ];

  stringToColor(role: string): string {
    const hash = this.hashString(role);
    return this.COLOR_MAP[hash];
  }

  hashString(string: string): number {
    let hash = 0;
    for (let i = 0; i < string.length; i++) {
      hash += string.charCodeAt(i);
    }
    return hash % this.COLOR_MAP.length;
  }

  formatTuple(tuple: ?(Array<number> | Vector3 | Vector6)) {
    if (tuple != null && tuple.length > 0) {
      const tupleRounded = tuple.map(value => Utils.roundTo(value, 2));
      return `(${tupleRounded.join(", ")})`;
    } else {
      return "";
    }
  }

  formatScale(scaleArr: Vector3): string {
    if (scaleArr != null && scaleArr.length > 0) {
      const scaleArrRounded = scaleArr.map(value => Utils.roundTo(value, 2));
      return `${scaleArrRounded.join(" × ")} nm³`;
    } else {
      return "";
    }
  }
}

export default new TemplateHelpers();
