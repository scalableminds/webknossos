import _ from "lodash";
import ErrorHandling from "libs/error_handling";

import type { Saga } from "oxalis/model/sagas/effect-generators";
import { call, put, takeEvery } from "typed-redux-saga";
import { ComputeQuickSelectForRectAction } from "oxalis/model/actions/volumetracing_actions";
import Toast from "libs/toast";

import { setBusyBlockingInfoAction, setIsQuickSelectActiveAction } from "../actions/ui_actions";
import performQuickSelectHeuristic from "./quick_select_heuristic_saga";
import performQuickSelectML from "./quick_select_ml_saga";

const use_ml = true;

export default function* listenToQuickSelect(): Saga<void> {
  yield* takeEvery(
    "COMPUTE_QUICK_SELECT_FOR_RECT",
    function* guard(action: ComputeQuickSelectForRectAction) {
      try {
        yield* put(setBusyBlockingInfoAction(true, "Selecting segment"));
        yield* put(setIsQuickSelectActiveAction(true));
        if (use_ml) {
          yield* call(performQuickSelectML, action);
        } else {
          yield* call(performQuickSelectHeuristic, action);
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
}
