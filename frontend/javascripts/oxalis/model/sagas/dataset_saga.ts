import type { Saga } from "oxalis/model/sagas/effect-generators";
import { select } from "oxalis/model/sagas/effect-generators";
import { call, takeEvery } from "typed-redux-saga";
import { sleep } from "libs/utils";
import { getEnabledLayers } from "oxalis/model/accessors/dataset_accessor";
import Toast from "libs/toast";
import messages from "messages";
import { getCurrentResolution } from "../accessors/flycam_accessor";
export function* watchMaximumRenderableLayers(): Saga<void> {
  function* warnMaybe(): Saga<void> {
    const maximumLayerCountToRender = yield* select(
      (state) => state.temporaryConfiguration.gpuSetup.maximumLayerCountToRender,
    );
    const enabledLayerCount = yield* select(
      (state) => getEnabledLayers(state.dataset, state.datasetConfiguration).length,
    );

    if (enabledLayerCount > maximumLayerCountToRender) {
      Toast.error(
        messages["webgl.too_many_active_layers"]({
          maximumLayerCountToRender,
        }),
        {
          sticky: true,
          key: "TOO_MANY_ACTIVE_LAYERS",
        },
      );
    } else {
      Toast.close("TOO_MANY_ACTIVE_LAYERS");
    }
  }

  yield* takeEvery(["WK_READY", "UPDATE_LAYER_SETTING", "UPDATE_DATASET_SETTING"], warnMaybe);
}

let userClosedWarning = false;
export function* watchZ1Downsampling(): Saga<void> {
  function* maybeShowWarning(): Saga<void> {
    const currentRes = yield* select((state) => getCurrentResolution(state));
    const currentZoomStep = yield* select((state) => state.flycam.zoomStep);
    if (currentZoomStep < 1) {
      // If the user has zoomed into the data,
      // the rendering quality is expected to be relatively low.
      // Don't show any warnings in that case.
      return;
    }
    const minVoxelPerPixel = 0.2;
    const setUserClosedWarningTrue = () => {
      userClosedWarning = true;
    };
    if (!userClosedWarning) {
      // checking only the downsampled dimensions x and y
      for (let i = 0; i < 2; i++) {
        const voxelPerPixelXY = currentZoomStep / currentRes[i];
        if (voxelPerPixelXY < minVoxelPerPixel) {
          Toast.warning(messages["dataset.z1_downsampling_hint"], {
            sticky: true,
            key: "DOWNSAMPLING_CAUSES_BAD_QUALITY",
            onClose: setUserClosedWarningTrue,
          });
        } else {
          Toast.close("DOWNSAMPLING_CAUSES_BAD_QUALITY");
        }
      }
    }
  }
  yield* takeEvery("WK_READY", maybeShowWarning);
  yield* call(sleep, 2000);
  yield* call(maybeShowWarning);
  yield* takeEvery(
    ["ZOOM_IN", "ZOOM_OUT", "ZOOM_BY_DELTA", "SET_ZOOM_STEP", "SET_STORED_LAYOUTS"],
    maybeShowWarning,
  );
}
