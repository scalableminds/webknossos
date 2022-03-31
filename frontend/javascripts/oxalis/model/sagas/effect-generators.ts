// @noflow
// The typings are defined in effect-generators.js.flow.
import * as IOEffects from "redux-saga/effects";
// Prefer to use these functions in combination with `yield*`
// as they provide better typing safety with flow.
// @ts-expect-error ts-migrate(7019) FIXME: Rest parameter 'args' implicitly has an 'any[]' ty... Remove this comment to see the full error message
export function* select(...args) {
  // @ts-expect-error ts-migrate(7057) FIXME: 'yield' expression implicitly results in an 'any' ... Remove this comment to see the full error message
  return yield IOEffects.select(...args);
}
// @ts-expect-error ts-migrate(7019) FIXME: Rest parameter 'args' implicitly has an 'any[]' ty... Remove this comment to see the full error message
export function* put(...args) {
  // @ts-expect-error ts-migrate(7057) FIXME: 'yield' expression implicitly results in an 'any' ... Remove this comment to see the full error message
  return yield IOEffects.put(...args);
}
// @ts-expect-error ts-migrate(7019) FIXME: Rest parameter 'args' implicitly has an 'any[]' ty... Remove this comment to see the full error message
export function* call(...args) {
  // @ts-expect-error ts-migrate(7057) FIXME: 'yield' expression implicitly results in an 'any' ... Remove this comment to see the full error message
  return yield IOEffects.call(...args);
}
// @ts-expect-error ts-migrate(7019) FIXME: Rest parameter 'args' implicitly has an 'any[]' ty... Remove this comment to see the full error message
export function* retry(...args) {
  // @ts-expect-error ts-migrate(7057) FIXME: 'yield' expression implicitly results in an 'any' ... Remove this comment to see the full error message
  return yield IOEffects.retry(...args);
}
// @ts-expect-error ts-migrate(7019) FIXME: Rest parameter 'args' implicitly has an 'any[]' ty... Remove this comment to see the full error message
export function* cps(...args) {
  // @ts-expect-error ts-migrate(7057) FIXME: 'yield' expression implicitly results in an 'any' ... Remove this comment to see the full error message
  return yield IOEffects.cps(...args);
}
// @ts-expect-error ts-migrate(7019) FIXME: Rest parameter 'args' implicitly has an 'any[]' ty... Remove this comment to see the full error message
export function* fork(...args) {
  // @ts-expect-error ts-migrate(7057) FIXME: 'yield' expression implicitly results in an 'any' ... Remove this comment to see the full error message
  return yield IOEffects.fork(...args);
}
export function* cancelled() {
  // @ts-expect-error ts-migrate(7057) FIXME: 'yield' expression implicitly results in an 'any' ... Remove this comment to see the full error message
  return yield IOEffects.cancelled();
}
// @ts-expect-error ts-migrate(7019) FIXME: Rest parameter 'args' implicitly has an 'any[]' ty... Remove this comment to see the full error message
export function* take(...args) {
  // @ts-expect-error ts-migrate(7057) FIXME: 'yield' expression implicitly results in an 'any' ... Remove this comment to see the full error message
  return yield IOEffects.take(...args);
}
// @ts-expect-error ts-migrate(7019) FIXME: Rest parameter 'args' implicitly has an 'any[]' ty... Remove this comment to see the full error message
export function* race(...args) {
  // @ts-expect-error ts-migrate(7057) FIXME: 'yield' expression implicitly results in an 'any' ... Remove this comment to see the full error message
  return yield IOEffects.race(...args);
}
// @ts-expect-error ts-migrate(7019) FIXME: Rest parameter 'args' implicitly has an 'any[]' ty... Remove this comment to see the full error message
export function* join(...args) {
  // @ts-expect-error ts-migrate(7057) FIXME: 'yield' expression implicitly results in an 'any' ... Remove this comment to see the full error message
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
