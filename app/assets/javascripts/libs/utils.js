/**
 * utils.js
 * @flow
 */

import _ from "lodash";
import type { Vector3, Vector4, Vector6, BoundingBoxType } from "oxalis/constants";
import Maybe from "data.maybe";
import window from "libs/window";
import pako from "pako";
import type { APIUserType } from "admin/api_flow_types";

type Comparator<T> = (T, T) => -1 | 0 | 1;

const Utils = {
  clamp(a: number, x: number, b: number): number {
    return Math.max(a, Math.min(b, x));
  },

  zeroPad(num: number, zeros: number = 0): string {
    let paddedNum = `${num.toString()}`;
    while (paddedNum.length < zeros) {
      paddedNum = `0${paddedNum}`;
    }
    return paddedNum;
  },

  unflatten<T>(array: Array<T>, tupleSize: number): Array<Array<T>> {
    const result = [];
    for (let i = 0; i < array.length; i += tupleSize) {
      result.push(array.slice(i, i + tupleSize));
    }
    return result;
  },

  // sums up an array
  sum(array: Array<number>): number {
    return array.reduce((r, a) => r + a, 0);
  },

  roundTo(value: number, digits: number): number {
    const digitMultiplier = Math.pow(10, digits);
    return Math.round(value * digitMultiplier) / digitMultiplier;
  },

  capitalize(str: string): string {
    return str[0].toUpperCase() + str.slice(1);
  },

  intToHex(int: number, digits: number = 6): string {
    return (_.repeat("0", digits) + int.toString(16)).slice(-digits);
  },

  rgbToHex(color: Vector3): string {
    return `#${color.map(int => Utils.intToHex(int, 2)).join("")}`;
  },

  hexToRgb(hex: string): Vector3 {
    const bigint = parseInt(hex.slice(1), 16);
    const r = (bigint >> 16) & 255;
    const g = (bigint >> 8) & 255;
    const b = bigint & 255;
    return [r, g, b];
  },

  hexToRgba(hex: string): Vector4 {
    const bigint = parseInt(hex.slice(1), 16);
    const r = (bigint >> 16) & 255;
    const g = (bigint >> 8) & 255;
    const b = bigint & 255;
    return [r, g, b, 1];
  },

  computeBoundingBoxFromArray(bb: ?Vector6): ?BoundingBoxType {
    if (bb == null) return null;

    const [x, y, z, width, height, depth] = bb;

    return {
      min: [x, y, z],
      max: [x + width, y + height, z + depth],
    };
  },

  computeArrayFromBoundingBox(bb: ?BoundingBoxType): ?Vector6 {
    return bb != null
      ? [
          bb.min[0],
          bb.min[1],
          bb.min[2],
          bb.max[0] - bb.min[0],
          bb.max[1] - bb.min[1],
          bb.max[2] - bb.min[2],
        ]
      : null;
  },

  compareBy<T: Object>(key: string, isSortedAscending: boolean = true): Comparator<T> {
    // generic key comparator for array.prototype.sort
    return function(a: T, b: T) {
      if (!isSortedAscending) {
        [a, b] = [b, a];
      }
      if (a[key] < b[key]) {
        return -1;
      }
      if (a[key] > b[key]) {
        return 1;
      }
      return 0;
    };
  },

  localeCompareBy<T: Object>(
    selector: string | (T => string),
    isSortedAscending: boolean = true,
  ): (T, T) => number {
    const sortingOrder = isSortedAscending ? 1 : -1;

    return (a: T, b: T): number => {
      const valueA: string = typeof selector === "function" ? selector(a) : a[selector];
      const valueB: string = typeof selector === "function" ? selector(b) : b[selector];
      return (
        valueA.localeCompare(valueB, "en", {
          numeric: true,
          usage: "search",
        }) * sortingOrder
      );
    };
  },

  stringToNumberArray(s: string): Array<number> {
    // remove leading/trailing whitespaces
    s = s.trim();
    // replace remaining whitespaces with commata
    s = s.replace(/,?\s+,?/g, ",");
    const stringArray = s.split(",");

    const result = [];
    for (const e of stringArray) {
      const newEl = parseFloat(e);
      if (!isNaN(newEl)) {
        result.push(newEl);
      }
    }

    return result;
  },

  concatVector3(a: Vector3, b: Vector3): Vector6 {
    return [a[0], a[1], a[2], b[0], b[1], b[2]];
  },

  numberArrayToVector3(array: Array<number>): Vector3 {
    const output = [0, 0, 0];
    for (let i = 0; i < Math.min(3, array.length); i++) {
      output[i] = array[i];
    }
    return output;
  },

  numberArrayToVector6(array: Array<number>): Vector6 {
    const output = [0, 0, 0, 0, 0, 0];
    for (let i = 0; i < Math.min(6, array.length); i++) {
      output[i] = array[i];
    }
    return output;
  },

  loaderTemplate(): string {
    return `\
<div id="loader-icon">
  <i class="fa fa-spinner fa-spin fa-4x"></i>
  <br>Loading
</div>`;
  },

  isElementInViewport(el: Element): boolean {
    const rect = el.getBoundingClientRect();
    return (
      document.documentElement != null &&
      rect.top >= 0 &&
      rect.left >= 0 &&
      rect.bottom <= (window.innerHeight || document.documentElement.clientHeight) &&
      rect.right <= (window.innerWidth || document.documentElement.clientWidth)
    );
  },

  // this is insecure and must not be used for security related functionality
  isUserModelAdmin(user: any): boolean {
    if (user == null) {
      return false;
    } else {
      return _.findIndex(user.get("teams"), team => team.role.name === "admin") >= 0;
    }
  },

  isUserAdmin(user: APIUserType): boolean {
    return _.findIndex(user.teams, team => team.role.name === "admin") >= 0;
  },

  getUrlParamsObject(): { [key: string]: string | boolean } {
    // Parse the URL parameters as objects and return it or just a single param
    return window.location.search
      .substring(1)
      .split("&")
      .reduce((result, value): void => {
        const parts = value.split("=");
        if (parts[0]) {
          const key = decodeURIComponent(parts[0]);
          if (parts[1]) {
            result[key] = decodeURIComponent(parts[1]);
          } else {
            result[key] = true;
          }
        }
        return result;
      }, {});
  },

  getUrlParamValue(paramName: string): string {
    const params = this.getUrlParamsObject();
    return params[paramName];
  },

  hasUrlParam(paramName: string): boolean {
    const params = this.getUrlParamsObject();
    return Object.prototype.hasOwnProperty.call(params, paramName);
  },

  __range__(left: number, right: number, inclusive: boolean): Array<number> {
    const range = [];
    const ascending = left < right;
    // eslint-disable-next-line no-nested-ternary
    const end = !inclusive ? right : ascending ? right + 1 : right - 1;
    for (let i = left; ascending ? i < end : i > end; ascending ? i++ : i--) {
      range.push(i);
    }
    return range;
  },

  __guard__<T, U>(value: ?T, transform: T => U) {
    return typeof value !== "undefined" && value !== null ? transform(value) : undefined;
  },

  sleep(timeout: number): Promise<void> {
    return new Promise(resolve => {
      setTimeout(resolve, timeout);
    });
  },

  animationFrame(): Promise<void> {
    return new Promise(resolve => {
      window.requestAnimationFrame(resolve);
    });
  },

  idleFrame(timeout: ?number = null): Promise<void> {
    return new Promise(resolve => {
      if (_.isFunction(window.reqeustIdleCallback)) {
        if (timeout != null) {
          window.reqeustIdleCallback(resolve, { timeout });
        } else {
          window.reqeustIdleCallback(resolve);
        }
      } else {
        this.sleep(timeout != null ? timeout : 100).then(resolve);
      }
    });
  },

  diffArrays<T>(
    stateA: Array<T>,
    stateB: Array<T>,
  ): { both: Array<T>, onlyA: Array<T>, onlyB: Array<T> } {
    const setA = new Set(stateA);
    const both = stateB.filter(x => setA.has(x));
    const bothSet = new Set(both);
    const onlyA = stateA.filter(x => !bothSet.has(x));
    const onlyB = stateB.filter(x => !bothSet.has(x));
    return { both, onlyA, onlyB };
  },

  zipMaybe<T, U>(maybeA: Maybe<T>, maybeB: Maybe<U>): Maybe<[T, U]> {
    return maybeA.chain(valueA => maybeB.map(valueB => [valueA, valueB]));
  },

  // Maybes getOrElse is defined as getOrElse(defaultValue: T): T, which is why
  // you can't do getOrElse(null) without flow complaining
  toNullable<T>(maybe: Maybe<T>): ?T {
    return maybe.isJust ? maybe.get() : null;
  },

  getRecursiveKeysAndValues(obj: Object): Array<any> {
    return _.flattenDeep(Utils.getRecursiveKeysAndValuesUnflat(obj));
  },

  getRecursiveKeysAndValuesUnflat(obj: Object): Array<any> {
    if (_.isArray(obj)) {
      return obj.map(Utils.getRecursiveKeysAndValuesUnflat);
    } else if (_.isObject(obj)) {
      return Object.keys(obj).map(key => [key, Utils.getRecursiveKeysAndValuesUnflat(obj[key])]);
    } else {
      return [obj];
    }
  },

  // Filters an array given a search string. Supports searching for several words as OR query.
  // Supports nested properties
  filterWithSearchQueryOR<T: Object>(
    collection: Array<T>,
    properties: Array<string>,
    searchQuery: string,
  ): Array<T> {
    if (searchQuery === "") {
      return collection;
    } else {
      const words = _.map(searchQuery.split(" "), element =>
        element.toLowerCase().replace(/[-[\]{}()*+?.,\\^$|#\s]/g, "\\$&"),
      );
      const uniques = _.filter(_.uniq(words), element => element !== "");
      const pattern = `(${uniques.join("|")})`;
      const regexp = new RegExp(pattern, "igm");

      return collection.filter(model =>
        _.some(properties, fieldName => {
          const value = model[fieldName];
          if (value !== null) {
            const values = Utils.getRecursiveKeysAndValues(value);
            return _.some(values, v => v.toString().match(regexp));
          } else {
            return false;
          }
        }),
      );
    }
  },

  // Filters an array given a search string. Supports searching for several words as AND query.
  // Supports nested properties
  filterWithSearchQueryAND<T: Object>(
    collection: Array<T>,
    properties: Array<string>,
    searchQuery: string,
  ): Array<T> {
    if (searchQuery === "") {
      return collection;
    } else {
      const words = _.map(searchQuery.split(" "), element =>
        element.toLowerCase().replace(/[-[\]{}()*+?.,\\^$|#\s]/g, "\\$&"),
      );
      const uniques = _.filter(_.uniq(words), element => element !== "");
      const patterns = uniques.map(pattern => new RegExp(pattern, "igm"));

      return collection.filter(model =>
        _.every(patterns, pattern =>
          _.some(properties, fieldName => {
            const value = model[fieldName];
            if (value !== null) {
              const values = Utils.getRecursiveKeysAndValues(value);
              return _.some(values, v => v.toString().match(pattern));
            } else {
              return false;
            }
          }),
        ),
      );
    }
  },

  millisecondsToMinutes(ms: number) {
    return ms / 60000;
  },

  minutesToMilliseconds(min: number) {
    return min * 60000;
  },

  async compress(data: Uint8Array | string): Promise<Uint8Array> {
    const DEFLATE_PUSH_SIZE = 65536;

    const deflator = new pako.Deflate({ gzip: true });
    for (let offset = 0; offset < data.length; offset += DEFLATE_PUSH_SIZE) {
      // The second parameter to push indicates whether this is the last chunk to be deflated
      deflator.push(
        data.slice(offset, offset + DEFLATE_PUSH_SIZE),
        offset + DEFLATE_PUSH_SIZE >= data.length,
      );
      // eslint-disable-next-line no-await-in-loop
      await Utils.sleep(1);
    }
    return deflator.result;
  },
};

export default Utils;
