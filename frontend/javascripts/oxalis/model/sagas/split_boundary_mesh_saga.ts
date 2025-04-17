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

function* updateSplitBoundaryMesh() {
  if (cleanUpFn != null) {
    cleanUpFn();
    cleanUpFn = null;
  }

  const isSplitToolkit = yield* select(
    (state) => state.userConfiguration.activeToolkit === "SPLIT_SEGMENTS",
  );
  if (!isSplitToolkit) {
    return;
  }

  const sceneController = yield* call(() => getSceneController());

  const activeTree = yield* select((state) => getActiveTree(state.annotation.skeleton));
  if (activeTree?.isVisible) {
    const nodes = Array.from(activeTree.nodes.values());
    const points = nodes.map((node) => node.untransformedPosition);
    if (points.length >= 2) {
      cleanUpFn = sceneController.addSplitBoundaryMesh(points);
    }
  }
}

export function* splitBoundaryMeshSaga(): Saga<void> {
  cleanUpFn = null;
  yield* takeWithBatchActionSupport("INITIALIZE_SKELETONTRACING");
  yield* ensureWkReady();

  // Call once for initial rendering
  yield* call(updateSplitBoundaryMesh);
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
        action.type === "UPDATE_USER_SETTING" && action.propertyName === "activeToolkit",
    ] as ActionPattern,
    updateSplitBoundaryMesh,
  );
}

export default splitBoundaryMeshSaga;
