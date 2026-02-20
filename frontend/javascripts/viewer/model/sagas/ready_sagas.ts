import { take, takeEvery } from "typed-redux-saga";
import type { Saga } from "viewer/model/sagas/effect-generators";
import { select } from "viewer/model/sagas/effect-generators";
import type { WebknossosState } from "viewer/store";

let isSceneControllerInitialized = false;

function setSceneControllerInitialized() {
  isSceneControllerInitialized = true;
}

function* listenForSceneControllerInitialized(): Saga<void> {
  yield* takeEvery("SCENE_CONTROLLER_INITIALIZED", setSceneControllerInitialized);
}

// The following two sagas are useful for other sagas that might be instantiated before or after
// the {WK,SCENE_CONTROLLER}_INITIALIZED action was dispatched. If the action was dispatched
// before, this saga immediately returns, otherwise it waits
// until the action is dispatched.

export function* ensureWkInitialized(): Saga<void> {
  const isWkInitialized = yield* select(
    (state: WebknossosState) => state.uiInformation.isWkInitialized,
  );
  if (isWkInitialized) return;
  yield* take("WK_INITIALIZED");
}

export function* ensureSceneControllerInitialized(): Saga<void> {
  if (isSceneControllerInitialized) return;
  yield* take("SCENE_CONTROLLER_INITIALIZED");
}

export default [listenForSceneControllerInitialized];
