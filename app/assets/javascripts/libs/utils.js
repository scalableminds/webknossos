/**
 * utils.js
 * @flow
 */

import _ from "lodash";
import type { Vector3 } from "oxalis/constants";

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
    return array.reduce(((r, a) => r + a), 0);
  },

  roundTo(value: number, digits: number): number {
    const digitMultiplier = Math.pow(10, digits);
    return Math.round(value * digitMultiplier) / digitMultiplier;
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

  compareBy<T: Object>(key: string, isSortedAscending: boolean = true): Comparator<T> {
    // generic key comparator for array.prototype.sort
    return function (a: T, b: T) {
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
      rect.top >= 0 &&
      rect.left >= 0 &&
      rect.bottom <= (window.innerHeight || document.documentElement.clientHeight) &&
      rect.right <= (window.innerWidth || document.documentElement.clientWidth)
    );
  },


  // this is insecure and must not be used for security related functionality
  isUserAdmin(user: any): boolean {
    if (user == null) {
      return false;
    } else {
      return _.findIndex(user.get("teams"), team => team.role.name === "admin") >= 0;
    }
  },


  getUrlParams(paramName: string): { [key: string]: string | boolean } {
    // Parse the URL parameters as objects and return it or just a single param
    const params = window.location.search.substring(1).split("&")
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

    if (paramName) { return params[paramName]; } else { return params; }
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

  __guard__<T, U>(value: ?T, transform: (T) => U) {
    return (typeof value !== "undefined" && value !== null) ? transform(value) : undefined;
  },

  sleep(timeout: number): Promise<void> {
    return new Promise((resolve) => { setTimeout(resolve, timeout); });
  },

  idleFrame(timeout: ?number = null): Promise<void> {
    return new Promise((resolve) => {
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
};

export default Utils;
