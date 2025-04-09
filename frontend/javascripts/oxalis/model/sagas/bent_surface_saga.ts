import getSceneController from "oxalis/controller/scene_controller_provider";
import type { Saga } from "oxalis/model/sagas/effect-generators";
import { select } from "oxalis/model/sagas/effect-generators";
import type { ActionPattern } from "redux-saga/effects";
import { call, takeEvery } from "typed-redux-saga";
import { getActiveTree } from "../accessors/skeletontracing_accessor";
import type { Action } from "../actions/actions";
import { ensureWkReady } from "./ready_sagas";
import { takeWithBatchActionSupport } from "./saga_helpers";

let cleanUpFn: (() => void) | null = null;

function* updateBentSurface() {
  if (cleanUpFn != null) {
    cleanUpFn();
    cleanUpFn = null;
  }

  const isSplitWorkspace = yield* select(
    (state) => state.userConfiguration.toolWorkspace === "SPLIT_SEGMENTS",
  );
  if (!isSplitWorkspace) {
    return;
  }

  const sceneController = yield* call(() => getSceneController());

  const activeTree = yield* select((state) => getActiveTree(state.annotation.skeleton));
  // biome-ignore lint/complexity/useOptionalChain: <explanation>
  if (activeTree != null && activeTree.isVisible) {
    const nodes = Array.from(activeTree.nodes.values());
    const points = nodes.map((node) => node.untransformedPosition);
    if (points.length > 3) {
      cleanUpFn = sceneController.addBentSurface(points);
    }
  }
}

export function* bentSurfaceSaga(): Saga<void> {
  cleanUpFn = null;
  yield* takeWithBatchActionSupport("INITIALIZE_SKELETONTRACING");
  yield* ensureWkReady();

  // initial rendering
  yield* call(updateBentSurface);
  yield* takeEvery(
    [
      "SET_ACTIVE_TREE",
      "SET_ACTIVE_TREE_BY_NAME",
      "CREATE_NODE",
      "DELETE_NODE",
      "DELETE_TREE",
      "SET_TREE_VISIBILITY",
      "TOGGLE_TREE",
      "SET_NODE_POSITION",
      (action: Action) =>
        action.type === "UPDATE_USER_SETTING" && action.propertyName === "toolWorkspace",
    ] as ActionPattern,
    updateBentSurface,
  );
}

export default bentSurfaceSaga;
