import _ from "lodash";
import ErrorHandling from "libs/error_handling";

import { Saga, select } from "oxalis/model/sagas/effect-generators";
import { call, all, put, takeEvery, takeLatest } from "typed-redux-saga";
import {
  ComputeQuickSelectForRectAction,
  ComputeSAMForSkeletonAction,
  MaybePrefetchEmbeddingAction,
} from "oxalis/model/actions/volumetracing_actions";
import Toast from "libs/toast";
import features from "features";

import { setBusyBlockingInfoAction, setQuickSelectStateAction } from "../actions/ui_actions";
import performQuickSelectHeuristic from "./quick_select_heuristic_saga";
import performQuickSelectML, {
  SAMNodeSelect,
  getInferenceSession,
  prefetchEmbedding,
} from "./quick_select_ml_saga";
import { AnnotationToolEnum, Vector3 } from "oxalis/constants";
import getSceneController from "oxalis/controller/scene_controller_provider";
import { enforceSkeletonTracing } from "../accessors/skeletontracing_accessor";
import Dimensions from "../dimensions";
import createProgressCallback from "libs/progress_callback";
import { Tree } from "oxalis/store";

function* shouldUseHeuristic() {
  const useHeuristic = yield* select((state) => state.userConfiguration.quickSelect.useHeuristic);
  return useHeuristic || !features().segmentAnythingEnabled;
}

export default function* listenToQuickSelect(): Saga<void> {
  yield* takeEvery(
    ["COMPUTE_QUICK_SELECT_FOR_RECT", "COMPUTE_SAM_FOR_SKELETON"],
    function* guard(action: ComputeQuickSelectForRectAction | ComputeSAMForSkeletonAction) {
      try {
        if (action.type === "COMPUTE_QUICK_SELECT_FOR_RECT") {
          yield* put(setBusyBlockingInfoAction(true, "Selecting segment"));

          yield* put(setQuickSelectStateAction("active"));
          if (yield* call(shouldUseHeuristic)) {
            yield* call(performQuickSelectHeuristic, action);
          } else {
            yield* call(performQuickSelectML, action);
          }
        } else {
          const tree: Tree = yield* select(
            (state) => enforceSkeletonTracing(state.tracing).trees[action.treeId],
          );
          const [firstDim, secondDim, _thirdDim] = Dimensions.getIndices(action.viewport);
          const busyBlockingInfo = yield* select((state) => state.uiInformation.busyBlockingInfo);

          if (busyBlockingInfo.isBusy) {
            console.warn(
              `Ignoring skelton SAM annotation request (reason: ${
                busyBlockingInfo.reason || "unknown"
              })`,
            );
            return;
          }

          yield* put(setBusyBlockingInfoAction(true, "Annotating nodes of Tree ..."));
          const progressCallback = createProgressCallback({
            pauseDelay: 200,
            successMessageDelay: 1000,
            key: "TREE_SAM_ANNOTATION_PROGRESS",
          });
          const nodeCount = tree.nodes.size();
          let currentNodeCount = 1;
          const predictionSagas = [];
          for (const node of tree.nodes.values()) {
            const nodePosition: Vector3 = [...node.position];
            const embeddingPrefectTopLeft: Vector3 = [...node.position];
            const embeddingPrefectBottomRight: Vector3 = [...node.position];
            embeddingPrefectTopLeft[firstDim] -= 100;
            embeddingPrefectTopLeft[secondDim] -= 100;
            embeddingPrefectBottomRight[firstDim] += 100;
            embeddingPrefectBottomRight[secondDim] += 100;
            const nodeSelect: SAMNodeSelect = {
              nodePosition,
              startPosition: embeddingPrefectTopLeft,
              endPosition: embeddingPrefectBottomRight,
              viewport: action.viewport,
            };
            predictionSagas.push(call(performQuickSelectML, nodeSelect));
            currentNodeCount++;
          }
          yield* all([...predictionSagas]);
          yield* call(progressCallback, true, "Finished annotating all nodes");
        }
      } catch (ex) {
        Toast.error((ex as Error).toString());
        ErrorHandling.notify(ex as Error);
        console.error(ex);
      } finally {
        yield* put(setBusyBlockingInfoAction(false));
        if (action.type === "COMPUTE_QUICK_SELECT_FOR_RECT") {
          action?.quickSelectGeometry.setCoordinates([0, 0, 0], [0, 0, 0]);
        }
        yield* put(setQuickSelectStateAction("inactive"));
      }
    },
  );

  yield* takeLatest(
    "MAYBE_PREFETCH_EMBEDDING",
    function* guard(action: MaybePrefetchEmbeddingAction) {
      const useHeuristic = yield* call(shouldUseHeuristic);
      if (!useHeuristic) {
        yield* call(prefetchEmbedding, action);
      }
    },
  );

  yield* takeEvery(["SET_TOOL", "CYCLE_TOOL"], function* guard() {
    const isQuickSelectTool = yield* select(
      (state) => state.uiInformation.activeTool === AnnotationToolEnum.QUICK_SELECT,
    );
    if (isQuickSelectTool && features().segmentAnythingEnabled) {
      // Retrieve the inference session to prefetch it as soon as the tool
      // is selected. If the session is cached, this is basically a noop.
      yield* call(getInferenceSession);
    }
  });

  yield* takeEvery("ESCAPE", function* handler() {
    if (yield* select((state) => state.uiInformation.quickSelectState === "drawing")) {
      // The user hit escape and the quick select mode should be canceled.
      // Escaping the preview mode is handled within the quick select sagas that support
      // preview mode (currently only the non-ml variant).
      yield* put(setQuickSelectStateAction("inactive"));
      const quickSelectGeometry = yield* call(() => getSceneController().quickSelectGeometry);
      quickSelectGeometry.setCoordinates([0, 0, 0], [0, 0, 0]);
    }
  });
}
