import _ from "lodash";
import ErrorHandling from "libs/error_handling";

import { Saga, select } from "oxalis/model/sagas/effect-generators";
import { call, put, takeEvery, takeLatest } from "typed-redux-saga";
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
          const tree = yield* select(
            (state) => enforceSkeletonTracing(state.tracing).trees[action.treeId],
          );
          for (const node of tree.nodes.values()) {
            const position = node.position;
            const embeddingPrefectTopLeft: Vector3 = [
              position[0] - 100,
              position[1] - 100,
              position[2],
            ];
            const embeddingPrefectBottomRight: Vector3 = [
              position[0] + 100,
              position[1] + 100,
              position[2],
            ];
            const nodeSelect: SAMNodeSelect = {
              nodePosition: position,
              startPosition: embeddingPrefectTopLeft,
              endPosition: embeddingPrefectBottomRight,
            };
            yield* call(performQuickSelectML, nodeSelect);
          }
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
