import _ from "lodash";
import ErrorHandling from "libs/error_handling";

import { Saga, select } from "oxalis/model/sagas/effect-generators";
import { call, put, takeEvery, takeLatest } from "typed-redux-saga";
import {
  ComputeQuickSelectForAreaAction,
  ComputeQuickSelectForRectAction,
  MaybePrefetchEmbeddingAction,
} from "oxalis/model/actions/volumetracing_actions";
import Toast from "libs/toast";
import features from "features";

import { setBusyBlockingInfoAction, setQuickSelectStateAction } from "../actions/ui_actions";
import performRectangleQuickSelectHeuristic from "./quick_select_heuristic_saga";
import performQuickSelectML, {
  getInferenceSession,
  prefetchEmbedding,
} from "./quick_select_ml_saga";
import { AnnotationToolEnum } from "oxalis/constants";
import getSceneController from "oxalis/controller/scene_controller_provider";

function* shouldUseHeuristic() {
  const useHeuristic = yield* select((state) => state.userConfiguration.quickSelect.useHeuristic);
  return useHeuristic || !features().segmentAnythingEnabled;
}

export default function* listenToQuickSelect(): Saga<void> {
  yield* takeEvery(
    ["COMPUTE_QUICK_SELECT_FOR_RECT", "COMPUTE_QUICK_SELECT_FOR_AREA"],
    function* guard(action: ComputeQuickSelectForRectAction | ComputeQuickSelectForAreaAction) {
      try {
        yield* put(setBusyBlockingInfoAction(true, "Selecting segment"));

        yield* put(setQuickSelectStateAction("active"));
        if (yield* call(shouldUseHeuristic)) {
          if (action.type === "COMPUTE_QUICK_SELECT_FOR_AREA") {
            throw new Error("Area quick select is not supported for the heuristic quick select.");
          }
          yield* call(performRectangleQuickSelectHeuristic, action);
        } else {
          yield* call(performQuickSelectML, action);
        }
      } catch (ex) {
        Toast.error((ex as Error).toString());
        ErrorHandling.notify(ex as Error);
        console.error(ex);
      } finally {
        yield* put(setBusyBlockingInfoAction(false));
        if (action.type === "COMPUTE_QUICK_SELECT_FOR_RECT") {
          action.quickSelectGeometry.setCoordinates([0, 0, 0], [0, 0, 0]);
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
      (state) =>
        state.uiInformation.activeTool === AnnotationToolEnum.RECTANGLE_QUICK_SELECT ||
        state.uiInformation.activeTool === AnnotationToolEnum.AREA_QUICK_SELECT,
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
      const quickSelectGeometry = yield* call(
        () => getSceneController().quickSelectRectangleGeometry,
      );
      quickSelectGeometry.setCoordinates([0, 0, 0], [0, 0, 0]);
    }
  });
}
