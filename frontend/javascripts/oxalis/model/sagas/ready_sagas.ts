import type { Saga } from "oxalis/model/sagas/effect-generators";
import { take, takeEvery } from "typed-redux-saga";

let isWkReady = false;
let isSceneControllerReady = false;

function setWkReady() {
  isWkReady = true;
}

function setSceneControllerReady() {
  isSceneControllerReady = true;
}

export function setWkReadyToFalse() {
  isWkReady = false;
}

function* listenForWkReady(): Saga<void> {
  yield* takeEvery("WK_READY", setWkReady);
}
function* listenForSceneControllerReady(): Saga<void> {
  yield* takeEvery("SCENE_CONTROLLER_READY", setSceneControllerReady);
}

// The following two sagas are useful for other sagas that might be instantiated before or after
// the {WK,SCENE_CONTROLLER}_READY action was dispatched. If the action was dispatched
// before, this saga immediately returns, otherwise it waits
// until the action is dispatched.

export function* ensureWkReady(): Saga<void> {
  if (isWkReady) return;
  yield* take("WK_READY");
}

export function* ensureSceneControllerReady(): Saga<void> {
  if (isSceneControllerReady) return;
  yield* take("SCENE_CONTROLLER_READY");
}

export default [listenForWkReady, listenForSceneControllerReady];
