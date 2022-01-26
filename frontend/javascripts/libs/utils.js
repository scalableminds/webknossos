// @flow
import Maybe from "data.maybe";
import _ from "lodash";
import naturalSort from "javascript-natural-sort";

import type { APIUser } from "types/api_flow_types";
import type { BoundingBoxObject } from "oxalis/store";
import type {
  Vector3,
  Vector4,
  Vector6,
  BoundingBoxType,
  Point3,
  ColorObject,
} from "oxalis/constants";
import window, { document, location } from "libs/window";

export type Comparator<T> = (T, T) => -1 | 0 | 1;
type UrlParams = { [key: string]: string };

// Fix JS modulo bug
// http://javascript.about.com/od/problemsolving/a/modulobug.htm
export function mod(x: number, n: number) {
  return ((x % n) + n) % n;
}

export function values<K, V>(o: { [K]: V }): Array<V> {
  // $FlowIssue[incompatible-return] remove once https://github.com/facebook/flow/issues/2221 is fixed
  return Object.values(o);
}

export function map2<A, B>(fn: (A, number) => B, tuple: [A, A]): [B, B] {
  const [x, y] = tuple;
  return [fn(x, 0), fn(y, 1)];
}

export function map3<A, B>(fn: (A, number) => B, tuple: [A, A, A]): [B, B, B] {
  const [x, y, z] = tuple;
  return [fn(x, 0), fn(y, 1), fn(z, 2)];
}

export function floor3(tuple: Vector3): Vector3 {
  const [x, y, z] = tuple;
  return [Math.floor(x), Math.floor(y), Math.floor(z)];
}

export function iterateThroughBounds(
  minVoxel: Vector3,
  maxVoxel: Vector3,
  fn: (number, number, number) => void,
): void {
  for (let x = minVoxel[0]; x < maxVoxel[0]; x++) {
    for (let y = minVoxel[1]; y < maxVoxel[1]; y++) {
      for (let z = minVoxel[2]; z < maxVoxel[2]; z++) {
        fn(x, y, z);
      }
    }
  }
}

function swap(arr, a, b) {
  let tmp;
  if (arr[a] > arr[b]) {
    tmp = arr[b];
    arr[b] = arr[a];
    arr[a] = tmp;
  }
}

naturalSort.insensitive = true;

function getRecursiveValues(obj: {} | Array<*> | string): Array<*> {
  return _.flattenDeep(getRecursiveValuesUnflat(obj));
}

function getRecursiveValuesUnflat(obj: {} | Array<*> | string): Array<*> {
  if (Array.isArray(obj)) {
    return obj.map(getRecursiveValuesUnflat);
  } else if (obj instanceof Object) {
    return Object.keys(obj).map(key => getRecursiveValuesUnflat(obj[key]));
  } else {
    return [obj];
  }
}

function cheapSort<T: string | number>(valueA: T, valueB: T): -1 | 0 | 1 {
  // $FlowFixMe[invalid-compare] It is not possible to express that valueA and valueB have the very same type
  if (valueA < valueB) return -1;
  // $FlowFixMe[invalid-compare] It is not possible to express that valueA and valueB have the very same type
  if (valueA > valueB) return 1;
  return 0;
}

export function enforce<A, B>(fn: A => B): (?A) => B {
  return (nullableA: ?A) => {
    if (nullableA == null) {
      throw new Error("Could not enforce while unwrapping maybe");
    }
    return fn(nullableA);
  };
}

export function maybe<A, B>(fn: A => B): (?A) => Maybe<B> {
  return (nullableA: ?A) => Maybe.fromNullable(nullableA).map(fn);
}

export function parseAsMaybe(str: ?string): Maybe<any> {
  try {
    const parsedJSON = JSON.parse(str || "");
    if (parsedJSON != null) {
      return Maybe.Just(parsedJSON);
    } else {
      return Maybe.Nothing();
    }
  } catch (exception) {
    return Maybe.Nothing();
  }
}

export async function tryToAwaitPromise<T>(promise: Promise<T>): Promise<?T> {
  try {
    return await promise;
  } catch (exception) {
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

export function jsonStringify(json: Object) {
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
  return `#${color.map(int => intToHex(Math.round(int), 2)).join("")}`;
}

export function hexToRgb(hex: string): Vector3 {
  const bigint = parseInt(hex.slice(1), 16);
  const r = (bigint >> 16) & 255;
  const g = (bigint >> 8) & 255;
  const b = bigint & 255;
  return [r, g, b];
}

export function colorObjectToRGBArray({ r, g, b }: ColorObject): Vector3 {
  return [r, g, b];
}

export function getRandomColor(): Vector3 {
  // Generate three values between 0 and 1 that multiplied with 255 will be integers.
  const randomColor = [0, 1, 2].map(() => Math.floor(Math.random() * 256) / 255);
  return ((randomColor: any): Vector3);
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

export function aggregateBoundingBox(boundingBoxes: Array<BoundingBoxObject>): BoundingBoxType {
  if (boundingBoxes.length === 0) {
    return {
      min: [0, 0, 0],
      max: [0, 0, 0],
    };
  }

  const allCoordinates = [0, 1, 2].map(index =>
    boundingBoxes
      .map(box => box.topLeft[index])
      .concat(
        boundingBoxes.map(box => {
          const bottomRight = [
            box.topLeft[0] + box.width,
            box.topLeft[1] + box.height,
            box.topLeft[2] + box.depth,
          ];
          return bottomRight[index];
        }),
      ),
  );
  const min = (([0, 1, 2].map(index => Math.min(...allCoordinates[index])): any): Vector3);
  const max = (([0, 1, 2].map(index => Math.max(...allCoordinates[index])): any): Vector3);
  return { min, max };
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
  collectionForTypeInference: Array<T>, // this parameter is only used let flow infer the used type
  selector: T => number,
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
  collectionForTypeInference: Array<T>, // this parameter is only used let flow infer the used type
  selector: T => string,
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
  // replace remaining whitespaces with commata
  s = s.replace(/,?\s+,?/g, ",");
  const stringArray = s.split(",");

  const result = [];
  for (const e of stringArray) {
    const newEl = parseFloat(e);
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
  const output = [0, 0, 0];
  for (let i = 0; i < Math.min(3, array.length); i++) {
    output[i] = array[i];
  }
  return output;
}

export function numberArrayToVector6(array: Array<number>): Vector6 {
  const output = [0, 0, 0, 0, 0, 0];
  for (let i = 0; i < Math.min(6, array.length); i++) {
    output[i] = array[i];
  }
  return output;
}

export function point3ToVector3({ x, y, z }: Point3): Vector3 {
  return [x, y, z];
}

export function vector3ToPoint3([x, y, z]: Vector3): Point3 {
  return { x, y, z };
}

export function isUserTeamManager(user: APIUser): boolean {
  return _.findIndex(user.teams, team => team.isTeamManager) >= 0;
}

export function isUserAdmin(user: APIUser): boolean {
  return user.isAdmin;
}

export function isUserAdminOrTeamManager(user: APIUser): boolean {
  return user.isAdmin || isUserTeamManager(user);
}

export function isUserDatasetManager(user: APIUser): boolean {
  return user.isDatasetManager;
}

export function isUserAdminOrDatasetManager(user: APIUser): boolean {
  return isUserAdmin(user) || isUserDatasetManager(user);
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
  // eslint-disable-next-line no-nested-ternary
  const end = !inclusive ? right : ascending ? right + 1 : right - 1;
  for (let i = left; ascending ? i < end : i > end; ascending ? i++ : i--) {
    range.push(i);
  }
  return range;
}

export function __guard__<T, U>(value: ?T, transform: T => U) {
  return typeof value !== "undefined" && value !== null ? transform(value) : undefined;
}

export function sleep(timeout: number): Promise<void> {
  return new Promise(resolve => {
    setTimeout(resolve, timeout);
  });
}

export function isFileExtensionEqualTo(
  fileName: string,
  extensionOrExtensions: string | Array<string>,
) {
  const passedExtension = _.last(fileName.split(".")).toLowerCase();

  if (Array.isArray(extensionOrExtensions)) {
    return extensionOrExtensions.includes(passedExtension);
  }

  return passedExtension === extensionOrExtensions;
}

// Only use this function if you really need a busy wait (useful
// for testing performance-related edge cases). Prefer `sleep`
// otherwise.
export function busyWaitDevHelper(time: number) {
  const start = new Date();
  let now;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    now = new Date();
    if (now - start >= time) {
      break;
    }
  }
}

export function animationFrame(maxTimeout?: number): Promise<void> {
  const rafPromise = new Promise(resolve => {
    window.requestAnimationFrame(resolve);
  });
  if (maxTimeout == null) {
    return rafPromise;
  }
  const timeoutPromise = sleep(maxTimeout);
  return Promise.race([rafPromise, timeoutPromise]);
}

export function diffArrays<T>(
  stateA: Array<T>,
  stateB: Array<T>,
): { both: Array<T>, onlyA: Array<T>, onlyB: Array<T> } {
  const setA = new Set(stateA);
  const both = stateB.filter(x => setA.has(x));
  const bothSet = new Set(both);
  const onlyA = stateA.filter(x => !bothSet.has(x));
  const onlyB = stateB.filter(x => !bothSet.has(x));
  return { both, onlyA, onlyB };
}

export function zipMaybe<T, U>(maybeA: Maybe<T>, maybeB: Maybe<U>): Maybe<[T, U]> {
  return maybeA.chain(valueA => maybeB.map(valueB => [valueA, valueB]));
}

// Maybes getOrElse is defined as getOrElse(defaultValue: T): T, which is why
// you can't do getOrElse(null) without flow complaining
export function toNullable<T>(_maybe: Maybe<T>): ?T {
  return _maybe.isJust ? _maybe.get() : null;
}

// TODO: Remove this function as it's currently unused
// Filters an array given a search string. Supports searching for several words as OR query.
// Supports nested properties
export function filterWithSearchQueryOR<T: { +[string]: mixed }, P: $Keys<T>>(
  collection: Array<T>,
  properties: Array<P | (T => {} | Array<*> | string)>,
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
        const value = typeof fieldName === "function" ? fieldName(model) : model[fieldName];
        if (value != null && (typeof value === "string" || value instanceof Object)) {
          const recursiveValues = getRecursiveValues(value);
          return _.some(recursiveValues, v => v != null && v.toString().match(regexp));
        } else {
          return false;
        }
      }),
    );
  }
}

// Filters an array given a search string. Supports searching for several words as AND query.
// Supports nested properties
export function filterWithSearchQueryAND<T: { +[string]: mixed }, P: $Keys<T>>(
  collection: Array<T>,
  properties: Array<P | (T => {} | Array<*> | string)>,
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
          const value = typeof fieldName === "function" ? fieldName(model) : model[fieldName];
          if (value !== null && (typeof value === "string" || value instanceof Object)) {
            const recursiveValues = getRecursiveValues(value);
            return _.some(recursiveValues, v => v != null && v.toString().match(pattern));
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
      // $FlowExpectedError[unsafe-getters-setters]
      get passive() {
        // This function will be called when the browser
        //   attempts to access the passive property.
        passiveSupported = true;
        return true;
      },
    };

    window.addEventListener("test", options, options);
    window.removeEventListener("test", options, options);
  } catch (err) {
    passiveSupported = false;
  }
  return passiveSupported;
});

// https://stackoverflow.com/questions/25248286/native-js-equivalent-to-jquery-delegation#
export function addEventListenerWithDelegation(
  element: HTMLElement,
  eventName: string,
  delegateSelector: string,
  handlerFunc: Function,
  options: Object = {},
) {
  const wrapperFunc = function(event: Event) {
    // $FlowIssue[prop-missing] Flow doesn't know native InputEvents
    for (let { target } = event; target && target !== this; target = target.parentNode) {
      // $FlowIssue[prop-missing] Flow doesn't know native InputEvents
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
  return { [eventName]: wrapperFunc };
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
  const tryToResolve = resolve => {
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

export function waitForElementWithId(elementId: string): Promise<*> {
  const tryToResolve = resolve => {
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
  const divMod = n => [Math.floor(n / 256), n % 256];
  let tmp = num;
  // eslint-disable-next-line one-var
  let r, g, b, a;

  [tmp, r] = divMod(tmp); // eslint-disable-line prefer-const
  [tmp, g] = divMod(tmp); // eslint-disable-line prefer-const
  [tmp, b] = divMod(tmp); // eslint-disable-line prefer-const
  [tmp, a] = divMod(tmp); // eslint-disable-line prefer-const

  // Big endian
  return [a, b, g, r];
}

export async function promiseAllWithErrors<T>(
  promises: Array<Promise<T>>,
): Promise<{ successes: Array<T>, errors: Array<Error> }> {
  const successOrErrorObjects = await Promise.all(promises.map(p => p.catch(error => error)));
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
    { successes: [], errors: [] },
  );
}

// This function will chunk an array of elements by time (or some other numeric value).
// Only subsequent elements are potentially put into the same chunk.
// The mapToTimeFn should be a function that maps from an element to a number.
// It'll return an array of chunks.
export function chunkIntoTimeWindows<T>(
  elements: Array<T>,
  mapToTimeFn: T => number,
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

export function convertBufferToImage(
  buffer: Uint8Array,
  width: number,
  height: number,
  flipHorizontally: boolean = true,
): Promise<Blob> {
  return new Promise(resolve => {
    width = Math.round(width);
    height = Math.round(height);
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");

    canvas.width = width;
    canvas.height = height;

    const imageData = ctx.createImageData(width, height);
    imageData.data.set(buffer);
    ctx.putImageData(imageData, 0, 0);

    if (flipHorizontally) {
      ctx.transform(1, 0, 0, -1, 0, height);
      ctx.drawImage(canvas, 0, 0);
    }

    canvas.toBlob(blob => resolve(blob));
  });
}

export function getIsInIframe() {
  try {
    return window.self !== window.top;
  } catch (e) {
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

export function disableViewportMetatag() {
  const viewport = document.querySelector("meta[name=viewport]");
  if (!viewport) {
    return;
  }
  viewport.setAttribute("content", "");
}

/**
 * Deep diff between two object, using lodash
 * @param  {Object} object Object compared
 * @param  {Object} base   Object to compare with
 * @return {Object}        Return a new object who represent the diff
 *
 * Source: https://gist.github.com/Yimiprod/7ee176597fef230d1451#gistcomment-2699388
 */
export function diffObjects(object: Object, base: Object): Object {
  function changes(_object, _base) {
    let arrayIndexCounter = 0;
    return _.transform(_object, (result, value, key) => {
      if (!_.isEqual(value, _base[key])) {
        const resultKey = _.isArray(_base) ? arrayIndexCounter++ : key;
        result[resultKey] =
          _.isObject(value) && _.isObject(_base[key]) ? changes(value, _base[key]) : value;
      }
    });
  }
  return changes(object, base);
}
