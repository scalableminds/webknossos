import Toast from "libs/toast";
import { Saga } from "redux-saga";
import { call, put, takeEvery, takeLatest } from "redux-saga/effects";
import { setBusyBlockingInfoAction, setQuickSelectStateAction } from "../actions/ui_actions";
import { MaybePrefetchEmbeddingAction } from "../actions/volumetracing_actions";
import { prefetchEmbedding } from "./quick_select_ml_saga";

export default function* listenToBrushSizeChange(): Saga<void> {
  yield* takeEvery(
    "SET_IS_BRUSH_SIZE_POPOVER_OPEN",
    function* guard(action: ShowBrushSizePopoverAction) {
      try {
        yield* put(setBusyBlockingInfoAction(true, "Selecting segment"));

        yield* put(setQuickSelectStateAction("active"));
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
}
