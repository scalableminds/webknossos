// @noflow
// The typings are defined in effect-generators.js.flow.
import * as IOEffects from "redux-saga/effects";

// Prefer to use these functions in combination with `yield*`
// as they provide better typing safety with flow.

export function* select(...args) {
  return yield IOEffects.select(...args);
}

export function* put(...args) {
  return yield IOEffects.put(...args);
}

export function* call(...args) {
  return yield IOEffects.call(...args);
}

export function* retry(...args) {
  return yield IOEffects.retry(...args);
}

export function* cps(...args) {
  return yield IOEffects.cps(...args);
}

export function* fork(...args) {
  return yield IOEffects.fork(...args);
}

export function* cancelled() {
  return yield IOEffects.cancelled();
}

export function* take(...args) {
  return yield IOEffects.take(...args);
}

export function* race(...args) {
  return yield IOEffects.race(...args);
}

export function* join(...args) {
  return yield IOEffects.join(...args);
}

// Use these prefixed functions with `yield` or when passing them to effect
// combinators, such as `race` or `all`.
export const _take = IOEffects.take;
export const _call = IOEffects.call;
export const _retry = IOEffects.retry;
export const _takeEvery = IOEffects.takeEvery;
export const _takeLeading = IOEffects.takeLeading;
export const _takeLatest = IOEffects.takeLatest;
export const _throttle = IOEffects.throttle;
export const _debounce = IOEffects.debounce;
export const _cancel = IOEffects.cancel;
export const _all = IOEffects.all;
export const _delay = IOEffects.delay;
export const _actionChannel = IOEffects.actionChannel;
export const _fork = IOEffects.fork;
