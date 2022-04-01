// The typings are defined in effect-generators.js.flow.
import { OxalisState } from "oxalis/store";
import {select as _select} from "typed-redux-saga";
import type { Saga as _Saga, Task as _Task } from "redux-saga";

export function* select<T>(fn: (state: OxalisState) => T) {
  const res: T = yield _select(fn);
  return res;
}

// Prefer to use these functions in combination with `yield*`
// as they provide better typing safety with flow.
// export function* select(...args) {
//   return yield IOEffects.select(...args);
// }

export type Saga<T> = Generator<any, T, any>;
export type Task<T> = Generator<any, T, any>;