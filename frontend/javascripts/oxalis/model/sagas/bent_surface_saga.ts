import getSceneController from "oxalis/controller/scene_controller_provider";
import type { Saga } from "oxalis/model/sagas/effect-generators";
import { select } from "oxalis/model/sagas/effect-generators";
import { call, takeEvery } from "typed-redux-saga";
import { getActiveTree } from "../accessors/skeletontracing_accessor";
import { ensureWkReady } from "./ready_sagas";
import { takeWithBatchActionSupport } from "./saga_helpers";

let cleanUpFn: (() => void) | null = null;

function* createBentSurface() {
  if (cleanUpFn != null) {
    cleanUpFn();
    cleanUpFn = null;
  }

  const sceneController = yield* call(() => getSceneController());

  // const points: Vector3[] = [
  //   [40, 50, 60],
  //   [50, 70, 60],
  //   [80, 70, 90],
  //   [50, 60, 80],
  // ];

  const activeTree = yield* select((state) => getActiveTree(state.tracing.skeleton));
  // biome-ignore lint/complexity/useOptionalChain: <explanation>
  if (activeTree != null && activeTree.isVisible) {
    const nodes = Array.from(activeTree.nodes.values());
    const points = nodes.map((node) => node.untransformedPosition);
    console.log("points", points);
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
  yield* call(createBentSurface);
  yield* takeEvery(
    [
      "SET_ACTIVE_TREE",
      "SET_ACTIVE_TREE_BY_NAME",
      "CREATE_NODE",
      "DELETE_NODE",
      "SET_TREE_VISIBILITY",
      "TOGGLE_TREE",
    ],
    createBentSurface,
  );
}

export default bentSurfaceSaga;
