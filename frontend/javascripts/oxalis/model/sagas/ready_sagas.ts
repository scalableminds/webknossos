import type { Saga } from "oxalis/model/sagas/effect-generators";
import type { OxalisState } from "oxalis/store";
import { select, take, takeEvery } from "typed-redux-saga";

let isSceneControllerReady = false;

function setSceneControllerReady() {
  isSceneControllerReady = true;
}

function* listenForSceneControllerReady(): Saga<void> {
  yield* takeEvery("SCENE_CONTROLLER_READY", setSceneControllerReady);
}

// The following two sagas are useful for other sagas that might be instantiated before or after
// the {WK,SCENE_CONTROLLER}_READY action was dispatched. If the action was dispatched
// before, this saga immediately returns, otherwise it waits
// until the action is dispatched.

export function* ensureWkReady(): Saga<void> {
  const isWkReady = yield* select((state: OxalisState) => state.uiInformation.isWkReady);
  if (isWkReady) return;
  yield* take("WK_READY");
}

export function* ensureSceneControllerReady(): Saga<void> {
  if (isSceneControllerReady) return;
  yield* take("SCENE_CONTROLLER_READY");
}

export default [listenForSceneControllerReady];
