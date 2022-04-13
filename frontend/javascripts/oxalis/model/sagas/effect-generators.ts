// The typings are defined in effect-generators.js.flow.
import { OxalisState } from "oxalis/store";
import type { Action } from "oxalis/model/actions/actions";
import {select as _select, take as _take} from "typed-redux-saga";
import type { Channel } from "redux-saga";
import { ActionPattern } from "redux-saga/effects";

export function* select<T>(fn: (state: OxalisState) => T) {
  const res: T = yield _select(fn);
  return res;
}

export function* take(pattern: ActionPattern<Action> | Channel<Action>): Generator<any, Action, any> {
  // @ts-ignore TS does not know that _take also accepts Channel<Action>
  return yield* _take(pattern);
}

export { call } from "typed-redux-saga";

// Prefer to use these functions in combination with `yield*`
// as they provide better typing safety with flow.
// export function* select(...args) {
//   return yield IOEffects.select(...args);
// }

export type Saga<T> = Generator<any, T, any>;
export type Task<T> = Generator<any, T, any>;
