import _ from "lodash";
import ErrorHandling from "libs/error_handling";

import { Saga, select } from "oxalis/model/sagas/effect-generators";
import { call, put, takeEvery } from "typed-redux-saga";
import {
  ComputeQuickSelectForRectAction,
  MaybePrefetchEmbeddingAction,
} from "oxalis/model/actions/volumetracing_actions";
import Toast from "libs/toast";
import features from "features";

import { setBusyBlockingInfoAction, setIsQuickSelectActiveAction } from "../actions/ui_actions";
import performQuickSelectHeuristic from "./quick_select_heuristic_saga";
import performQuickSelectML, { prefetchEmbedding } from "./quick_select_ml_saga";

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

  yield* takeEvery(
    "MAYBE_PREFETCH_EMBEDDING",
    function* guard(action: MaybePrefetchEmbeddingAction) {
      const useHeuristic = yield* call(shouldUseHeuristic);
      if (!useHeuristic) {
        yield* call(prefetchEmbedding, action);
      }
    },
  );
}
