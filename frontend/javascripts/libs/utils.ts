import Maybe from "data.maybe";
import dayjs from "dayjs";
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'java... Remove this comment to see the full error message
import naturalSort from "javascript-natural-sort";
import window, { document, location } from "libs/window";
import _ from "lodash";
import type {
  BoundingBoxType,
  ColorObject,
  Point3,
  TypedArray,
  Vector3,
  Vector4,
  Vector6,
} from "oxalis/constants";
import type { BoundingBoxObject, NumberLike } from "oxalis/store";
import type { APIDataset, APIUser } from "types/api_flow_types";
import type { ArbitraryObject, Comparator } from "types/globals";

type UrlParams = Record<string, string>;
// Fix JS modulo bug
// http://javascript.about.com/od/problemsolving/a/modulobug.htm
export function mod(x: number, n: number) {
  return ((x % n) + n) % n;
}

export function keys<T extends string>(o: Record<T, any>): T[] {
  return Object.keys(o) as Array<keyof typeof o>;
}

export function values<T>(o: { [s: string]: T } | ArrayLike<T>): T[] {
  return Object.values(o);
}

export function entries<T>(o: { [s: string]: T } | ArrayLike<T>): [string, T][] {
  return Object.entries(o);
}

export function map2<A, B>(fn: (arg0: A, arg1: 0 | 1) => B, tuple: [A, A]): [B, B] {
  const [x, y] = tuple;
  return [fn(x, 0), fn(y, 1)];
}

export function map3<A, B>(fn: (arg0: A, arg1: 0 | 1 | 2) => B, tuple: [A, A, A]): [B, B, B] {
  const [x, y, z] = tuple;
  return [fn(x, 0), fn(y, 1), fn(z, 2)];
}

export function take2<A>(tuple: [A, A, A] | [A, A, A, A]): [A, A] {
  return [tuple[0], tuple[1]];
}

export function take3<A>(tuple: [A, A, A, A]): [A, A, A] {
  return [tuple[0], tuple[1], tuple[2]];
}

export function map4<A, B>(
  fn: (arg0: A, arg1: 0 | 1 | 2 | 3) => B,
  tuple: [A, A, A, A],
): [B, B, B, B] {
  const [x, y, z, q] = tuple;
  return [fn(x, 0), fn(y, 1), fn(z, 2), fn(q, 3)];
}

export function floor3(tuple: Vector3): Vector3 {
  const [x, y, z] = tuple;
  return [Math.floor(x), Math.floor(y), Math.floor(z)];
}

export function iterateThroughBounds(
  minVoxel: Vector3,
  maxVoxel: Vector3,
  fn: (arg0: number, arg1: number, arg2: number) => void,
): void {
  for (let x = minVoxel[0]; x < maxVoxel[0]; x++) {
    for (let y = minVoxel[1]; y < maxVoxel[1]; y++) {
      for (let z = minVoxel[2]; z < maxVoxel[2]; z++) {
        fn(x, y, z);
      }
    }
  }
}

function swap<T>(arr: Array<T>, a: number, b: number) {
  let tmp: T;

  if (arr[a] > arr[b]) {
    tmp = arr[b];
    arr[b] = arr[a];
    arr[a] = tmp;
  }
}

naturalSort.insensitive = true;

function getRecursiveValues(obj: ArbitraryObject | Array<any> | string): Array<any> {
  return _.flattenDeep(getRecursiveValuesUnflat(obj));
}

function getRecursiveValuesUnflat(obj: ArbitraryObject | Array<any> | string): Array<any> {
  if (Array.isArray(obj)) {
    return obj.map(getRecursiveValuesUnflat);
  } else if (obj instanceof Object) {
    // @ts-ignore
    return Object.keys(obj).map((key) => getRecursiveValuesUnflat(obj[key]));
  } else {
    return [obj];
  }
}

function cheapSort<T extends string | number>(valueA: T, valueB: T): -1 | 0 | 1 {
  if (valueA < valueB) return -1;
  if (valueA > valueB) return 1;
  return 0;
}

export function unique<T>(array: Array<T>): Array<T> {
  return [...new Set(array)];
}

export function union<T>(iterables: Array<Iterable<T>>): Set<T> {
  const set: Set<T> = new Set();

  for (const iterable of iterables) {
    for (const item of iterable) {
      set.add(item);
    }
  }

  return set;
}

export function enforce<A, B>(fn: (arg0: A) => B): (arg0: A | null | undefined) => B {
  return (nullableA: A | null | undefined) => {
    if (nullableA == null) {
      throw new Error("Could not enforce while unwrapping maybe");
    }

    return fn(nullableA);
  };
}

export function maybe<A, B>(fn: (arg0: A) => B): (arg0: A | null | undefined) => Maybe<B> {
  return (nullableA: A | null | undefined) => Maybe.fromNullable(nullableA).map(fn);
}

export function parseMaybe(str: string | null | undefined): unknown | null {
  try {
    const parsedJSON = JSON.parse(str || "");

    if (parsedJSON != null) {
      return parsedJSON;
    } else {
      return null;
    }
  } catch (_exception) {
    return null;
  }
}

export async function tryToAwaitPromise<T>(promise: Promise<T>): Promise<T | null | undefined> {
  try {
    return await promise;
  } catch (_exception) {
    return null;
  }
}

export function asAbortable<T>(
  promise: Promise<T>,
  signal: AbortSignal,
  abortError: Error,
): Promise<T> {
  return new Promise(async (resolve, reject) => {
    const abort = () => reject(abortError);

    signal.addEventListener("abort", abort);

    try {
      const value = await promise;
      resolve(value);
    } catch (error) {
      reject(error);
    }

    signal.removeEventListener("abort", abort);
  });
}

export function jsonStringify(json: Record<string, any>) {
  return JSON.stringify(json, null, "  ");
}

export function clamp(min: number, value: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function zeroPad(num: number, zeros: number = 0): string {
  let paddedNum = `${num.toString()}`;

  while (paddedNum.length < zeros) {
    paddedNum = `0${paddedNum}`;
  }

  return paddedNum;
}

export function roundTo(value: number, digits: number): number {
  const digitMultiplier = Math.pow(10, digits);
  return Math.round(value * digitMultiplier) / digitMultiplier;
}

export function capitalize(str: string): string {
  return str[0].toUpperCase() + str.slice(1);
}

function intToHex(int: number, digits: number = 6): string {
  return (_.repeat("0", digits) + int.toString(16)).slice(-digits);
}

export function rgbToInt(color: Vector3): number {
  return (color[0] << 16) + (color[1] << 8) + color[2];
}

export function rgbToHex(color: Vector3): string {
  return `#${color.map((int) => intToHex(Math.round(int), 2)).join("")}`;
}

export function hexToRgb(hex: string): Vector3 {
  const bigint = Number.parseInt(hex.slice(1), 16);
  const r = (bigint >> 16) & 255;
  const g = (bigint >> 8) & 255;
  const b = bigint & 255;
  return [r, g, b];
}
/**
 * Converts an HSL color value to RGB. Conversion formula
 * adapted from http://en.wikipedia.org/wiki/HSL_color_space.
 * Assumes h, s, l, and a are contained in the set [0, 1] and
 * returns r, g, b, and a in the set [0, 1].
 *
 * Taken from:
 * https://stackoverflow.com/a/9493060
 */
export function hslaToRgba(hsla: Vector4): Vector4 {
  const [h, s, l, a] = hsla;
  let r: number;
  let g: number;
  let b: number;

  if (s === 0) {
    r = g = b = l; // achromatic
  } else {
    const hue2rgb = function hue2rgb(p: number, q: number, t: number) {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };

    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }

  return [r, g, b, a];
}

export function colorObjectToRGBArray({ r, g, b }: ColorObject): Vector3 {
  return [r, g, b];
}

export function getRandomColor(): Vector3 {
  // Generate three values between 0 and 1 that multiplied with 255 will be integers.
  const randomColor = [0, 1, 2].map(() => Math.floor(Math.random() * 256) / 255);
  return randomColor as any as Vector3;
}

export function computeBoundingBoxFromArray(bb: Vector6): BoundingBoxType {
  const [x, y, z, width, height, depth] = bb;
  return {
    min: [x, y, z],
    max: [x + width, y + height, z + depth],
  };
}

export function computeBoundingBoxFromBoundingBoxObject(bb: BoundingBoxObject): BoundingBoxType {
  return computeBoundingBoxFromArray([...bb.topLeft, bb.width, bb.height, bb.depth]);
}

export function computeBoundingBoxObjectFromBoundingBox(bb: BoundingBoxType): BoundingBoxObject {
  const boundingBoxArray = computeArrayFromBoundingBox(bb);
  return {
    topLeft: [boundingBoxArray[0], boundingBoxArray[1], boundingBoxArray[2]],
    width: boundingBoxArray[3],
    height: boundingBoxArray[4],
    depth: boundingBoxArray[5],
  };
}

export function computeArrayFromBoundingBox(bb: BoundingBoxType): Vector6 {
  return [
    bb.min[0],
    bb.min[1],
    bb.min[2],
    bb.max[0] - bb.min[0],
    bb.max[1] - bb.min[1],
    bb.max[2] - bb.min[2],
  ];
}

export function computeShapeFromBoundingBox(bb: BoundingBoxType): Vector3 {
  return [bb.max[0] - bb.min[0], bb.max[1] - bb.min[1], bb.max[2] - bb.min[2]];
}

export function aggregateBoundingBox(boundingBoxes: Array<BoundingBoxObject>): BoundingBoxType {
  if (boundingBoxes.length === 0) {
    return {
      min: [0, 0, 0],
      max: [0, 0, 0],
    };
  }

  const allCoordinates = [0, 1, 2].map((index) =>
    boundingBoxes
      .map((box) => box.topLeft[index])
      .concat(
        boundingBoxes.map((box) => {
          const bottomRight = [
            box.topLeft[0] + box.width,
            box.topLeft[1] + box.height,
            box.topLeft[2] + box.depth,
          ];
          return bottomRight[index];
        }),
      ),
  );
  const min = [0, 1, 2].map((index) => Math.min(...allCoordinates[index])) as any as Vector3;
  const max = [0, 1, 2].map((index) => Math.max(...allCoordinates[index])) as any as Vector3;
  return {
    min,
    max,
  };
}

export function areBoundingBoxesOverlappingOrTouching(
  firstBB: BoundingBoxType,
  secondBB: BoundingBoxType,
) {
  let areOverlapping = true;

  for (let dim = 0; dim < 3 && areOverlapping; ++dim) {
    areOverlapping = firstBB.max[dim] >= secondBB.min[dim] && secondBB.max[dim] >= firstBB.min[dim];
  }

  return areOverlapping;
}

export function compareBy<T>(
  selector: (arg0: T) => number,
  isSortedAscending: boolean = true,
): Comparator<T> {
  return (a: T, b: T) => {
    if (!isSortedAscending) {
      [a, b] = [b, a];
    }

    const valueA = selector(a);
    const valueB = selector(b);

    if (typeof valueA !== "number" || typeof valueB !== "number") {
      console.error(
        "Wrong compare method called (compareBy should only be called for numbers). Selector:",
        selector,
      );
      return 0;
    }

    return cheapSort(valueA, valueB);
  };
}

export function localeCompareBy<T>(
  selector: (arg0: T) => string,
  isSortedAscending: boolean = true,
  sortNatural: boolean = true,
): Comparator<T> {
  return (a: T, b: T) => {
    if (!isSortedAscending) {
      [a, b] = [b, a];
    }

    const valueA = selector(a);
    const valueB = selector(b);

    if (typeof valueA !== "string" || typeof valueB !== "string") {
      console.error(
        "Wrong compare method called (localeCompareBy should only be called for strings). Selector:",
        selector,
      );
      return 0;
    }

    // localeCompare is really slow, therefore, we use the naturalSort lib and a cheap sorting otherwise
    return sortNatural ? naturalSort(valueA, valueB) : cheapSort(valueA, valueB);
  };
}

export function stringToNumberArray(s: string): Array<number> {
  // remove leading/trailing whitespaces
  s = s.trim();
  // replace remaining whitespaces with commas
  s = s.replace(/,?\s+,?/g, ",");
  const stringArray = s.split(",");
  const result = [];

  for (const e of stringArray) {
    const newEl = Number.parseFloat(e);

    if (!Number.isNaN(newEl)) {
      result.push(newEl);
    }
  }

  return result;
}

export function concatVector3(a: Vector3, b: Vector3): Vector6 {
  return [a[0], a[1], a[2], b[0], b[1], b[2]];
}

export function numberArrayToVector3(array: Array<number>): Vector3 {
  const output: Vector3 = [0, 0, 0];

  for (let i = 0; i < Math.min(3, array.length); i++) {
    output[i] = array[i];
  }

  return output;
}

export function numberArrayToVector6(array: Array<number>): Vector6 {
  const output: Vector6 = [0, 0, 0, 0, 0, 0];

  for (let i = 0; i < Math.min(6, array.length); i++) {
    output[i] = array[i];
  }

  return output;
}

export function point3ToVector3({ x, y, z }: Point3): Vector3 {
  return [x, y, z];
}

export function vector3ToPoint3([x, y, z]: Vector3): Point3 {
  return {
    x,
    y,
    z,
  };
}

export function transformToCSVRow(dataRow: any[]) {
  return dataRow
    .map(String) // convert every value to String
    .map((v) => v.replaceAll('"', '""')) // escape double quotes
    .map((v) => (v.includes(",") || v.includes('"') ? `"${v}"` : v)) // quote it if necessary
    .join(","); // comma-separated
}

export function isUserTeamManager(user: APIUser): boolean {
  return _.findIndex(user.teams, (team) => team.isTeamManager) >= 0;
}

export function isUserAdmin(user: APIUser): boolean {
  return user.isAdmin;
}

export function isUserAdminOrTeamManager(user: APIUser): boolean {
  return isUserAdmin(user) || isUserTeamManager(user);
}

export function isUserDatasetManager(user: APIUser): boolean {
  return user.isDatasetManager;
}

export function isUserAdminOrDatasetManager(user: APIUser | null | undefined): boolean {
  return user != null && (isUserAdmin(user) || isUserDatasetManager(user));
}

export function isUserAdminOrManager(user: APIUser): boolean {
  return isUserAdmin(user) || isUserTeamManager(user) || isUserDatasetManager(user);
}

export function mayUserEditDataset(user: APIUser | null | undefined, dataset: APIDataset): boolean {
  return (
    isUserAdminOrDatasetManager(user) &&
    user != null &&
    user.organization === dataset.owningOrganization
  );
}

export function getUrlParamsObject(): UrlParams {
  return getUrlParamsObjectFromString(location.search);
}

export function getUrlParamsObjectFromString(str: string): UrlParams {
  // Parse the URL parameters as objects and return it or just a single param
  return str
    .substring(1)
    .split("&")
    .reduce((result: UrlParams, value: string): UrlParams => {
      const parts = value.split("=");

      if (parts[0]) {
        const key = decodeURIComponent(parts[0]);

        if (parts[1]) {
          result[key] = decodeURIComponent(parts[1]);
        } else {
          result[key] = "true";
        }
      }

      return result;
    }, {});
}

export function getUrlParamValue(paramName: string): string {
  const params = getUrlParamsObject();
  return params[paramName];
}

export function hasUrlParam(paramName: string): boolean {
  const params = getUrlParamsObject();
  return Object.prototype.hasOwnProperty.call(params, paramName);
}

export function __range__(left: number, right: number, inclusive: boolean): Array<number> {
  const range = [];
  const ascending = left < right;

  const end = !inclusive ? right : ascending ? right + 1 : right - 1;

  for (let i = left; ascending ? i < end : i > end; ascending ? i++ : i--) {
    range.push(i);
  }

  return range;
}

export function sleep(timeout: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, timeout);
  });
}

export function isFileExtensionEqualTo(
  fileName: string | null | undefined,
  extensionOrExtensions: string | Array<string>,
) {
  if (fileName == null) {
    return false;
  }
  const passedExtension = (_.last(fileName.split(".")) || "").toLowerCase();

  if (Array.isArray(extensionOrExtensions)) {
    return extensionOrExtensions.includes(passedExtension);
  }

  return passedExtension === extensionOrExtensions;
}

// Parses dates in format "Thu Jan 1 00:00:00 1970 +0000".
export function parseCTimeDefaultDate(dateString: string) {
  const commitDateWithoutWeekday = dateString.replace(
    /(Mon)|(Tue)|(Wed)|(Thu)|(Fri)|(Sat)|(Sun)\w*/,
    "",
  );
  return dayjs(commitDateWithoutWeekday, "MMM D HH:mm:ss YYYY ZZ");
}

// Only use this function if you really need a busy wait (useful
// for testing performance-related edge cases). Prefer `sleep`
// otherwise.
export function busyWaitDevHelper(time: number) {
  const start = new Date();
  let now: Date;

  while (true) {
    now = new Date();

    // @ts-expect-error ts-migrate(2362) FIXME: The left-hand side of an arithmetic operation must... Remove this comment to see the full error message
    if (now - start >= time) {
      break;
    }
  }
}

export function animationFrame(maxTimeout?: number): Promise<number | undefined> {
  const rafPromise: Promise<ReturnType<typeof window.requestAnimationFrame>> = new Promise(
    (resolve) => {
      window.requestAnimationFrame(resolve);
    },
  );

  if (maxTimeout == null) {
    return rafPromise;
  }

  const timeoutPromise = sleep(maxTimeout) as Promise<undefined>;
  return Promise.race([rafPromise, timeoutPromise]);
}

export function diffArrays<T>(
  stateA: Array<T>,
  stateB: Array<T>,
): {
  both: Array<T>;
  onlyA: Array<T>;
  onlyB: Array<T>;
} {
  const setA = new Set(stateA);
  const both = stateB.filter((x) => setA.has(x));
  const bothSet = new Set(both);
  const onlyA = stateA.filter((x) => !bothSet.has(x));
  const onlyB = stateB.filter((x) => !bothSet.has(x));
  return {
    both,
    onlyA,
    onlyB,
  };
}

export function diffMaps<K, V>(
  stateA: Map<K, V>,
  stateB: Map<K, V>,
): {
  changed: Iterable<K>;
  onlyA: Iterable<K>;
  onlyB: Iterable<K>;
} {
  const keysOfA = Array.from(stateA.keys());
  const keysOfB = Array.from(stateB.keys());
  const changed = keysOfA.filter((x) => stateB.has(x) && stateB.get(x) !== stateA.get(x));
  const onlyA = keysOfA.filter((x) => !stateB.has(x));
  const onlyB = keysOfB.filter((x) => !stateA.has(x));
  return {
    changed,
    onlyA,
    onlyB,
  };
}

export function withoutValues<T>(arr: Array<T>, elements: Array<T>): Array<T> {
  // This set-based implementation avoids stackoverflow errors from which
  // _.without(arr, ...elements) suffers.
  // When measured against a chunk-based _.without approach, this implementation
  // is 20% faster.
  // _.pullValues was also tested, but this didn't even terminate in a minute
  // (whereas the other test sets could be tackled in under one second).

  const auxSet = new Set(elements);
  return arr.filter((x) => !auxSet.has(x));
}

// Maybes getOrElse is defined as getOrElse(defaultValue: T): T, which is why
// you can't do getOrElse(null) without flow complaining
export function toNullable<T>(_maybe: Maybe<T>): T | null | undefined {
  return _maybe.isJust ? _maybe.get() : null;
}

export function filterNullValues<T>(arr: Array<T | null | undefined>): T[] {
  // @ts-ignore
  return arr.filter((el) => el != null);
}

// Filters an array given a search string. Supports searching for several words as AND query.
// Supports nested properties.
// Its pendant was removed int #7783 as it was unused.
export function filterWithSearchQueryAND<
  T extends Readonly<Record<string, unknown>>,
  P extends keyof T,
>(
  collection: Array<T>,
  properties: Array<P | ((arg0: T) => P | Array<any> | string)>,
  searchQuery: string,
): Array<T> {
  if (searchQuery === "") {
    return collection;
  } else {
    const words = _.map(searchQuery.split(" "), (element) =>
      element.toLowerCase().replace(/[-[\]{}()*+?.,\\^$|#\s]/g, "\\$&"),
    );

    const uniques = _.filter(_.uniq(words), (element) => element !== "");

    const patterns = uniques.map((pattern) => new RegExp(pattern, "igm"));
    return collection.filter((model) =>
      _.every(patterns, (pattern) =>
        _.some(properties, (fieldName) => {
          const value = typeof fieldName === "function" ? fieldName(model) : model[fieldName];

          if (value !== null && (typeof value === "string" || value instanceof Object)) {
            const recursiveValues = getRecursiveValues(value);
            return _.some(recursiveValues, (v) => v?.toString().match(pattern));
          } else {
            return false;
          }
        }),
      ),
    );
  }
}

export function millisecondsToMinutes(ms: number) {
  return ms / 60000;
}

export function minutesToMilliseconds(min: number) {
  return min * 60000;
}

export function millisecondsToHours(ms: number) {
  const oneHourInMilliseconds = 1000 * 60 * 60;
  return ms / oneHourInMilliseconds;
}

export function isNoElementFocussed(): boolean {
  // checks whether an <input> or <button> element has the focus
  // when no element is focused <body> gets the focus
  return document.activeElement === document.body;
}

// https://developer.mozilla.org/en-US/docs/Web/API/EventTarget/addEventListener#Safely_detecting_option_support
const areEventListenerOptionsSupported = _.once(() => {
  let passiveSupported = false;

  try {
    const options = {
      get passive() {
        // This function will be called when the browser
        //   attempts to access the passive property.
        passiveSupported = true;
        return true;
      },
    };
    // @ts-expect-error ts-migrate(2339) FIXME: Property 'addEventListener' does not exist on type... Remove this comment to see the full error message
    window.addEventListener("test", options, options);
    // @ts-expect-error ts-migrate(2339) FIXME: Property 'removeEventListener' does not exist on t... Remove this comment to see the full error message
    window.removeEventListener("test", options, options);
  } catch (_err) {
    passiveSupported = false;
  }

  return passiveSupported;
});

// https://stackoverflow.com/questions/25248286/native-js-equivalent-to-jquery-delegation#
export function addEventListenerWithDelegation(
  element: HTMLElement | Document,
  eventName: string,
  delegateSelector: string,
  handlerFunc: (...args: Array<any>) => any,
  options: Record<string, any> = {},
) {
  const wrapperFunc = function (this: HTMLElement | Document, event: Event) {
    for (
      let { target } = event;
      target && target !== this && target instanceof Element;
      target = target.parentNode
    ) {
      if (target.matches(delegateSelector)) {
        handlerFunc.call(target, event);
        break;
      }
    }
  };

  element.addEventListener(
    eventName,
    wrapperFunc,
    areEventListenerOptionsSupported() ? options : false,
  );
  return {
    [eventName]: wrapperFunc,
  };
}

export function median8(dataArray: Array<number>): number {
  // Returns the median of an already *sorted* array of size 8 (e.g., with sortArray8)
  return Math.round((dataArray[3] + dataArray[4]) / 2);
}

export function mode8(arr: Array<number>): number {
  // Returns the mode of an already *sorted* array of size 8 (e.g., with sortArray8)
  let currentConsecCount = 0;
  let currentModeCount = 0;
  let currentMode = -1;
  let lastEl = null;

  for (let i = 0; i < 8; i++) {
    const el = arr[i];

    if (lastEl === el) {
      currentConsecCount++;

      if (currentConsecCount >= currentModeCount) {
        currentModeCount = currentConsecCount;
        currentMode = el;
      }
    } else {
      currentConsecCount = 1;
    }

    lastEl = el;
  }

  return currentMode;
}

export function sortArray8(arr: Array<number>): void {
  // This function sorts an array of size 8.
  // Swap instructions were generated here:
  // http://jgamble.ripco.net/cgi-bin/nw.cgi?inputs=8&algorithm=best&output=macro
  swap(arr, 0, 1);
  swap(arr, 2, 3);
  swap(arr, 0, 2);
  swap(arr, 1, 3);
  swap(arr, 1, 2);
  swap(arr, 4, 5);
  swap(arr, 6, 7);
  swap(arr, 4, 6);
  swap(arr, 5, 7);
  swap(arr, 5, 6);
  swap(arr, 0, 4);
  swap(arr, 1, 5);
  swap(arr, 1, 4);
  swap(arr, 2, 6);
  swap(arr, 3, 7);
  swap(arr, 3, 6);
  swap(arr, 2, 4);
  swap(arr, 3, 5);
  swap(arr, 3, 4);
}

// When an interval greater than RAF_INTERVAL_THRESHOLD is used,
// setTimeout is used instead of requestAnimationFrame.
const RAF_INTERVAL_THRESHOLD = 20;
export function waitForCondition(pred: () => boolean, interval: number = 0): Promise<void> {
  const tryToResolve = (resolve: () => void) => {
    if (pred()) {
      resolve();
    } else if (interval > RAF_INTERVAL_THRESHOLD) {
      setTimeout(() => tryToResolve(resolve), interval);
    } else {
      window.requestAnimationFrame(() => tryToResolve(resolve));
    }
  };

  return new Promise(tryToResolve);
}

export function waitForElementWithId(elementId: string): Promise<any> {
  const tryToResolve = (resolve: (value: any) => void) => {
    const el = document.getElementById(elementId);

    if (el) {
      resolve(el);
    } else {
      window.requestAnimationFrame(() => tryToResolve(resolve));
    }
  };

  return new Promise(tryToResolve);
}

export function convertDecToBase256(num: number): Vector4 {
  const divMod = (n: number) => [Math.floor(n / 256), n % 256];

  let tmp = num;

  let r: number, g: number, b: number, a: number;
  [tmp, r] = divMod(tmp);

  [tmp, g] = divMod(tmp);

  [tmp, b] = divMod(tmp);

  [tmp, a] = divMod(tmp);

  // Little endian
  return [r, g, b, a];
}

export function castForArrayType(uncastNumber: number, data: TypedArray): number | bigint {
  return data instanceof BigUint64Array ? BigInt(uncastNumber) : uncastNumber;
}

export function convertNumberTo64Bit(num: number | bigint | null): [Vector4, Vector4] {
  const [bigNumHigh, bigNumLow] = convertNumberTo64BitTuple(num);

  const low = convertDecToBase256(bigNumLow);
  const high = convertDecToBase256(bigNumHigh);

  return [high, low];
}

export function convertNumberTo64BitTuple(num: number | bigint | null): [number, number] {
  if (num == null || Number.isNaN(num)) {
    return [0, 0];
  }
  // Cast to BigInt as bit-wise operations only work with 32 bits,
  // even though Number uses 53 bits.
  const bigNum = BigInt(num);

  const bigNumLow = Number((2n ** 32n - 1n) & bigNum);
  const bigNumHigh = Number(bigNum >> 32n);

  return [bigNumHigh, bigNumLow];
}

export async function promiseAllWithErrors<T>(promises: Array<Promise<T>>): Promise<{
  successes: Array<T>;
  errors: Array<Error>;
}> {
  const successOrErrorObjects = await Promise.all(promises.map((p) => p.catch((error) => error)));
  return successOrErrorObjects.reduce(
    ({ successes, errors }, successOrError) => {
      if (successOrError instanceof Error) {
        return {
          successes,
          errors: errors.concat([successOrError]),
        };
      } else {
        return {
          successes: successes.concat([successOrError]),
          errors,
        };
      }
    },
    {
      successes: [],
      errors: [],
    },
  );
}

// This function will chunk an array of elements by time (or some other numeric value).
// Only subsequent elements are potentially put into the same chunk.
// The mapToTimeFn should be a function that maps from an element to a number.
// It'll return an array of chunks.
export function chunkIntoTimeWindows<T>(
  elements: Array<T>,
  mapToTimeFn: (arg0: T) => number,
  chunkByXMinutes: number,
): Array<Array<T>> {
  let chunkIndex = 0;
  let chunkTime = 0;
  return _.reduce(
    elements,
    (chunks: Array<Array<T>>, element: T, index: number) => {
      const elementTime = mapToTimeFn(element);
      if (index === 0) chunkTime = elementTime;

      if (Math.abs(chunkTime - elementTime) > chunkByXMinutes * 60 * 1000) {
        chunkIndex++;
        chunkTime = elementTime;
      }

      if (chunks[chunkIndex] == null) chunks.push([]);
      chunks[chunkIndex].push(element);
      return chunks;
    },
    [],
  );
}

// chunkDynamically takes an array of input elements and splits these
// into batches. Instead of using a constant batch size, the elements
// of a batch are measured with a measureFn. Then, each batch is filled
// until the provided minThreshold is exceeded.
// Note that the threshold will be exceeded for each batch
// (except for the last batch which may contain less).
export function chunkDynamically<T>(
  elements: T[],
  minThreshold: number,
  measureFn: (el: T) => number,
): Array<T[]> {
  const batches = [];
  let currentBatch = [];
  let currentSize = 0;

  for (let i = 0; i < elements.length; i++) {
    currentBatch.push(elements[i]);
    currentSize += measureFn(elements[i]);
    if (currentSize > minThreshold || i === elements.length - 1) {
      currentSize = 0;
      batches.push(currentBatch);
      currentBatch = [];
    }
  }
  return batches;
}

export function convertBufferToImage(
  buffer: Uint8Array,
  width: number,
  height: number,
  canvasToMerge: HTMLCanvasElement | null | undefined,
  drawImageIntoCanvasCallback: ((ctx: CanvasRenderingContext2D) => void) | null | undefined,
  flipHorizontally: boolean = false,
): Promise<Blob | null> {
  return new Promise((resolve) => {
    width = Math.round(width);
    height = Math.round(height);
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (ctx == null) {
      throw new Error("Could not create canvas 2d context.");
    }
    canvas.width = width;
    canvas.height = height;
    const imageData = ctx.createImageData(width, height);
    imageData.data.set(buffer);
    ctx.putImageData(imageData, 0, 0);

    if (flipHorizontally) {
      ctx.transform(1, 0, 0, -1, 0, height);
      ctx.drawImage(canvas, 0, 0);
      ctx.transform(1, 0, 0, -1, 0, height);
    }

    if (canvasToMerge != null) {
      ctx.drawImage(canvasToMerge, 0, 0);
    }

    if (drawImageIntoCanvasCallback) {
      drawImageIntoCanvasCallback(ctx);
    }
    canvas.toBlob((blob: Blob | null) => {
      canvas.remove();
      resolve(blob);
    });
  });
}

export function getIsInIframe() {
  try {
    return window.self !== window.top;
  } catch (_e) {
    return true;
  }
}

export function getWindowBounds(): [number, number] {
  // Function taken from https://stackoverflow.com/questions/3333329/javascript-get-browser-height.
  let width = 0;
  let height = 0;

  if (typeof window.innerWidth === "number") {
    // Non-IE
    width = window.innerWidth;
    height = window.innerHeight;
  } else if (
    document.documentElement &&
    (document.documentElement.clientWidth || document.documentElement.clientHeight)
  ) {
    // IE 6+ in 'standards compliant mode'
    width = document.documentElement.clientWidth;
    height = document.documentElement.clientHeight;
  } else if (document.body && (document.body.clientWidth || document.body.clientHeight)) {
    // IE 4 compatible
    width = document.body.clientWidth;
    height = document.body.clientHeight;
  }

  return [width, height];
}

/**
 * Deep diff between two object, using lodash
 * @param  {Object} object Object compared
 * @param  {Object} base   Object to compare with
 * @return {Object}        Return a new object who represent the diff
 *
 * Source: https://gist.github.com/Yimiprod/7ee176597fef230d1451#gistcomment-2699388
 */
export function diffObjects(
  object: Record<string, any>,
  base: Record<string, any>,
): Record<string, any> {
  function changes(_object: Record<string, any>, _base: Record<string, any>) {
    let arrayIndexCounter = 0;
    return _.transform(_object, (result, value, key) => {
      if (!_.isEqual(value, _base[key])) {
        const resultKey = _.isArray(_base) ? arrayIndexCounter++ : key;
        // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
        result[resultKey] =
          _.isObject(value) && _.isObject(_base[key]) ? changes(value, _base[key]) : value;
      }
    });
  }

  // @ts-expect-error ts-migrate(2322) FIXME: Type 'unknown' is not assignable to type 'Record<s... Remove this comment to see the full error message
  return changes(object, base);
}

export function fastDiffSetAndMap<T>(setA: Set<T>, mapB: Map<T, T>) {
  /*
   * This function was designed for a special use case within the mapping saga,
   * where a Set of (potentially new) segment IDs is passed for setA and a known mapping from
   * id->id is passed for mapB.
   * The function computes:
   * - aWithoutB: segment IDs that are in setA but not in mapB.keys()
   * - bWithoutA: segment IDs that are in mapB.keys() but not in setA
   * - intersection: a Map only contains keys that are in both setA and mapB.keys() (the values are used from mapB).
   */
  const aWithoutB = new Set<T>();
  const bWithoutA = new Set<T>();
  // This function assumes that the returned intersection is relatively large which is common
  // for the use case it was designed for. Under this assumption, mapB is simply copied to
  // initialize the intersection. Afterwards, items that are not within setA are removed from
  // the intersection.
  const intersection = new Map(mapB);

  for (const item of setA) {
    if (!mapB.has(item)) {
      aWithoutB.add(item);
    }
  }

  for (const item of mapB.keys()) {
    if (!setA.has(item)) {
      bWithoutA.add(item);
      intersection.delete(item);
    }
  }

  return {
    aWithoutB: aWithoutB,
    bWithoutA: bWithoutA,
    intersection: intersection,
  };
}

export function areVec3AlmostEqual(a: Vector3, b: Vector3, epsilon: number = 1e-6): boolean {
  return _.every(a.map((v, i) => Math.abs(v - b[i]) < epsilon));
}

export function coalesce<T extends {}>(e: T, token: any): T[keyof T] | null {
  return Object.values(e).includes(token as T[keyof T]) ? token : null;
}

export function pluralize(str: string, count: number, optPluralForm: string | null = null): string {
  if (count === 1) {
    return str;
  }
  if (optPluralForm != null) {
    return optPluralForm;
  }
  return `${str}s`;
}

export function conjugate(
  verbStr: string,
  count: number,
  optThirdForm: string | null = null,
): string {
  if (count >= 2) {
    return verbStr;
  }
  if (optThirdForm != null) {
    return optThirdForm;
  }
  return `${verbStr}s`;
}

export function truncateStringToLength(str: string, length: number): string {
  return str.length > length ? `${str.substring(0, length)}...` : str;
}

export function maxValue(array: Array<number>): number {
  const value = _.max(array);
  if (value == null) {
    throw Error(`Max of empty array: ${array}`);
  }
  return value;
}

export function minValue(array: Array<number>): number {
  const value = _.min(array);
  if (value == null) {
    throw Error(`Min of empty array: ${array}`);
  }
  return value;
}

/*
 * Iterates over arbitrary objects recursively and calls the callback function.
 */
type Obj = Record<string, unknown>;
export const deepIterate = (obj: Obj | Obj[] | null, callback: (val: unknown) => void) => {
  if (obj == null) {
    return;
  }
  const items = Array.isArray(obj) ? obj : Object.values(obj);
  items.forEach((item) => {
    callback(item);

    if (typeof item === "object") {
      // We know that item is an object or array which matches deepIterate's signature.
      // However, TS doesn't infer this.
      // @ts-ignore
      deepIterate(item, callback);
    }
  });
};

export function getFileExtension(fileName: string): string {
  const filenameParts = fileName.split(".");
  const fileExtension = filenameParts[filenameParts.length - 1].toLowerCase();
  return fileExtension;
}

export class SoftError extends Error {}

export function notEmpty<TValue>(value: TValue | null | undefined): value is TValue {
  // Strongly typed helper to filter any non empty values from an array
  // e.g. [1, 2, undefined].filter(notEmpty) => type should be number[]
  // Source https://github.com/microsoft/TypeScript/issues/45097#issuecomment-882526325
  return value !== null && value !== undefined;
}

export function isNumberMap(x: Map<NumberLike, NumberLike>): x is Map<number, number> {
  const { value } = x.entries().next();
  return Boolean(value && typeof value[0] === "number");
}

export function isBigInt(x: NumberLike): x is bigint {
  return typeof x === "bigint";
}

export function assertNever(value: never): never {
  throw new Error(`Unexpected value that is not 'never': ${JSON.stringify(value)}`);
}

/**
 * Returns a URL safe, base 62 encoded hash code from a string
 * @param  {String} str The string to hash.
 * @return {string}    A 32bit integer hash code encoded in base 62.
 * @see https://stackoverflow.com/questions/7616461/generate-a-hash-from-string-in-javascript (original link is dead)
 */
export function computeHash(str: string): string | undefined {
  let hash = 0;
  for (let i = 0, len = str.length; i < len; i++) {
    let chr = str.charCodeAt(i);
    hash = (hash << 5) - hash + chr;
    hash |= 0; // Convert to 32bit integer
  }
  const hashString = encodeToBase62(hash);
  return hashString;
}

export function encodeToBase62(numberToEncode: number): string {
  const base62Chars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
  if (numberToEncode === 0) return base62Chars[0];
  if (numberToEncode === -1) return base62Chars[61];
  let encoded = "";
  let num = numberToEncode;
  while (num !== 0 && num !== -1) {
    // for positive numberToEncode, num will eventually be 0, for negative numberToEncode, num will eventually be -1
    const modulo = mod(num, 62);
    encoded = base62Chars[modulo] + encoded;
    num = Math.floor(num / 62);
  }
  return encoded;
}

export function safeNumberToStr(num: number): string {
  if (typeof num === "number") {
    return `${num}`;
  }
  return "NaN";
}

export function generateRandomId(length: number) {
  let result = "";
  const characters = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const charactersLength = characters.length;
  let counter = 0;
  while (counter < length) {
    result += characters.charAt(Math.floor(Math.random() * charactersLength));
    counter += 1;
  }
  return result;
}

export function getPhraseFromCamelCaseString(stringInCamelCase: string): string {
  return stringInCamelCase
    .split(/(?=[A-Z])/)
    .map((word) => capitalize(word.replace(/(^|\s)td/, "$13D")))
    .join(" ");
}
