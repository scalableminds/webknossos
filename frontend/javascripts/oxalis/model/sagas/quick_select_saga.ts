import _ from "lodash";
import ErrorHandling from "libs/error_handling";

import { Saga, select } from "oxalis/model/sagas/effect-generators";
import { call, put, takeEvery, takeLatest } from "typed-redux-saga";
import {
  ComputeQuickSelectForRectAction,
  MaybePrefetchEmbeddingAction,
} from "oxalis/model/actions/volumetracing_actions";
import Toast from "libs/toast";
import features from "features";

import {
  CycleToolAction,
  setBusyBlockingInfoAction,
  setIsQuickSelectActiveAction,
  SetToolAction,
} from "../actions/ui_actions";
import performQuickSelectHeuristic from "./quick_select_heuristic_saga";
import performQuickSelectML, {
  getInferenceSession,
  prefetchEmbedding,
} from "./quick_select_ml_saga";
import { AnnotationToolEnum } from "oxalis/constants";

function* shouldUseHeuristic() {
  const useHeuristic = yield* select((state) => state.userConfiguration.quickSelect.useHeuristic);
  return useHeuristic || !features().segmentAnythingEnabled;
}

export default function* listenToQuickSelect(): Saga<void> {
  yield* takeEvery(
    "COMPUTE_QUICK_SELECT_FOR_RECT",
    function* guard(action: ComputeQuickSelectForRectAction) {
      try {
        yield* put(setBusyBlockingInfoAction(true, "Selecting segment"));

        yield* put(setIsQuickSelectActiveAction(true));
        if (yield* call(shouldUseHeuristic)) {
          yield* call(performQuickSelectHeuristic, action);
        } else {
          yield* call(performQuickSelectML, action);
        }
      } catch (ex) {
        Toast.error((ex as Error).toString());
        ErrorHandling.notify(ex as Error);
        console.error(ex);
      } finally {
        yield* put(setBusyBlockingInfoAction(false));
        action.quickSelectGeometry.setCoordinates([0, 0, 0], [0, 0, 0]);
        yield* put(setIsQuickSelectActiveAction(false));
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

  yield* takeEvery(
    ["SET_TOOL", "CYCLE_TOOL"],
    function* guard(action: CycleToolAction | SetToolAction) {
      console.log("action", action);
      const isQuickSelectTool = yield* select(
        (state) => state.uiInformation.activeTool === AnnotationToolEnum.QUICK_SELECT,
      );
      if (isQuickSelectTool && features().segmentAnythingEnabled) {
        // Retrieve the inference session to prefetch it as soon as the tool
        // is selected. If the session is cached, this is basically a noop.
        yield* call(getInferenceSession);
      }
    },
  );
}
