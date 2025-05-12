import type { ActionPattern } from "redux-saga/effects";
import { call, put, takeEvery } from "typed-redux-saga";
import getSceneController from "viewer/controller/scene_controller_provider";
import type { Saga } from "viewer/model/sagas/effect-generators";
import { select } from "viewer/model/sagas/effect-generators";
import { getActiveTree } from "../accessors/skeletontracing_accessor";
import { Toolkit } from "../accessors/tool_accessor";
import type { Action } from "../actions/actions";
import { setTreeEdgeVisibilityAction } from "../actions/skeletontracing_actions";
import { ensureWkReady } from "./ready_sagas";
import { takeWithBatchActionSupport } from "./saga_helpers";

// The clean up function removes the surface from the scene controller.
let cleanUpFn: (() => void) | null = null;

// This info object contains data about the tree that is currently
// adapted to not show its edges (because splines are rendered instead).
// When the split toolkit is left or when another tree is activated,
// the original value of edgesAreVisible is restored.
let temporarilyChangedTreeInfo: {
  treeId: number;
  originalEdgesAreVisible: boolean;
} | null = null;

function* restoreApperanceOfTree() {
  if (temporarilyChangedTreeInfo == null) {
    return;
  }
  yield* put(
    setTreeEdgeVisibilityAction(
      temporarilyChangedTreeInfo.treeId,
      temporarilyChangedTreeInfo.originalEdgesAreVisible,
    ),
  );
  temporarilyChangedTreeInfo = null;
}

function* updateSplitBoundaryMesh() {
  if (cleanUpFn != null) {
    cleanUpFn();
    cleanUpFn = null;
  }

  const isSplitToolkit = yield* select(
    (state) => state.userConfiguration.activeToolkit === Toolkit.SPLIT_SEGMENTS,
  );
  if (!isSplitToolkit) {
    yield* call(restoreApperanceOfTree);
    return;
  }

  const sceneController = yield* call(getSceneController);

  const activeTree = yield* select((state) => getActiveTree(state.annotation.skeleton));

  if (activeTree?.treeId !== temporarilyChangedTreeInfo?.treeId) {
    // The active tree changed.
    // Restore the appearance of the old tree.
    yield* call(restoreApperanceOfTree);

    // Update the appearance of the current tree.
    if (activeTree != null) {
      yield* put(setTreeEdgeVisibilityAction(activeTree.treeId, false));
    }

    // Update temporarilyChangedTreeInfo
    temporarilyChangedTreeInfo =
      activeTree != null
        ? {
            treeId: activeTree.treeId,
            originalEdgesAreVisible: activeTree.edgesAreVisible,
          }
        : null;
  }

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
  temporarilyChangedTreeInfo = null;
  yield* takeWithBatchActionSupport("INITIALIZE_SKELETONTRACING");
  yield* ensureWkReady();

  // Call once for initial rendering
  yield* call(updateSplitBoundaryMesh);
  yield* takeEvery(
    [
      "ADD_TREES_AND_GROUPS",
      "BATCH_UPDATE_GROUPS_AND_TREES",
      "CREATE_NODE",
      "CREATE_TREE",
      "DELETE_EDGE",
      "DELETE_NODE",
      "DELETE_TREE",
      "DELETE_TREES",
      "INITIALIZE_ANNOTATION_WITH_TRACINGS",
      "INITIALIZE_SKELETONTRACING",
      "MERGE_TREES",
      "SELECT_NEXT_TREE",
      "SET_ACTIVE_NODE",
      "SET_ACTIVE_TREE",
      "SET_ACTIVE_TREE_BY_NAME",
      "SET_NODE_POSITION",
      "SET_TRACING",
      "SET_TREE_VISIBILITY",
      "TOGGLE_ALL_TREES",
      "TOGGLE_INACTIVE_TREES",
      "TOGGLE_TREE",
      "TOGGLE_TREE_GROUP",
      (action: Action) =>
        action.type === "UPDATE_USER_SETTING" && action.propertyName === "activeToolkit",
    ] as ActionPattern,
    updateSplitBoundaryMesh,
  );
}

export default splitBoundaryMeshSaga;
