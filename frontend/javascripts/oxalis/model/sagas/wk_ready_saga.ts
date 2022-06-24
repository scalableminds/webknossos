import type { Saga } from "oxalis/model/sagas/effect-generators";
import { take, takeEvery } from "typed-redux-saga";

let isWkReady = false;

function setWkReady() {
  isWkReady = true;
}
export function* listenForWkReady(): Saga<void> {
  yield* takeEvery("WK_READY", setWkReady);
}

export function* ensureWkReady(): Saga<void> {
  // This saga is useful for sagas that might be instantiated before or after
  // the WK_READY action was dispatched. If the action was dispatched
  // before, this saga immediately returns, otherwise it waits
  // until the action is dispatched.
  if (isWkReady) return;
  yield* take("WK_READY");
}
