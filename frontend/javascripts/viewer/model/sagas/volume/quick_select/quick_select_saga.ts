import ErrorHandling from "libs/error_handling";

import features from "features";
import Toast from "libs/toast";
import { call, put, takeEvery } from "typed-redux-saga";
import type {
  ComputeQuickSelectForPointAction,
  ComputeQuickSelectForRectAction,
} from "viewer/model/actions/volumetracing_actions";
import { type Saga, select } from "viewer/model/sagas/effect-generators";

import getSceneController from "viewer/controller/scene_controller_provider";
import type { VolumeTracing } from "viewer/store";
import { getActiveSegmentationTracing } from "../../../accessors/volumetracing_accessor";
import { setBusyBlockingInfoAction, setQuickSelectStateAction } from "../../../actions/ui_actions";
import { requestBucketModificationInVolumeTracing } from "../../saga_helpers";
import performQuickSelectHeuristic from "./quick_select_heuristic_saga";
import performQuickSelectML from "./quick_select_ml_saga";

function* shouldUseHeuristic() {
  const useHeuristic = yield* select((state) => state.userConfiguration.quickSelect.useHeuristic);
  return useHeuristic || !features().segmentAnythingEnabled;
}

export default function* listenToQuickSelect(): Saga<void> {
  yield* takeEvery(
    ["COMPUTE_QUICK_SELECT_FOR_RECT", "COMPUTE_QUICK_SELECT_FOR_POINT"],
    function* guard(action: ComputeQuickSelectForRectAction | ComputeQuickSelectForPointAction) {
      try {
        const volumeTracing: VolumeTracing | null | undefined = yield* select(
          getActiveSegmentationTracing,
        );
        if (volumeTracing) {
          // As changes to the volume layer will be applied, the potentially existing mapping should be locked to ensure a consistent state.
          const isModificationAllowed = yield* call(
            requestBucketModificationInVolumeTracing,
            volumeTracing,
          );
          if (!isModificationAllowed) {
            return;
          }
        }
        const busyBlockingInfo = yield* select((state) => state.uiInformation.busyBlockingInfo);
        if (busyBlockingInfo.isBusy) {
          console.warn(
            `Ignoring ${action.type} request (reason: ${busyBlockingInfo.reason || "null"})`,
          );
          return;
        }
        yield* put(setBusyBlockingInfoAction(true, "Quick-Selecting segment"));

        yield* put(setQuickSelectStateAction("active"));
        if (yield* call(shouldUseHeuristic)) {
          yield* call(performQuickSelectHeuristic, action);
        } else {
          yield* call(performQuickSelectML, action);
        }
      } catch (ex) {
        Toast.error((ex as Error).toString());
        ErrorHandling.notify(ex as Error);
      } finally {
        yield* put(setBusyBlockingInfoAction(false));
        action.quickSelectGeometry.setCoordinates([0, 0, 0], [0, 0, 0]);
        yield* put(setQuickSelectStateAction("inactive"));
      }
    },
  );

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
