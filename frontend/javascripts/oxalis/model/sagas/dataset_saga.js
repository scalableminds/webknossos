// @flow
import { type Saga, _takeEvery, select } from "oxalis/model/sagas/effect-generators";
import {
  getEnabledColorLayers,
  isSegmentationLayerEnabled,
} from "oxalis/model/accessors/dataset_accessor";
import Toast from "libs/toast";
import messages from "messages";

// import messages from "messages";

export function* watchIsScratchSaga(): Saga<void> {
  // yield* take("WK_READY");
  // const isScratch = yield* select(state => state.dataset.dataStore.isScratch);
  // if (isScratch) {
  //   Toast.error(messages["dataset.is_scratch"], { sticky: true });
  // }
}

export function* watchMaximumRenderableLayers(): Saga<void> {
  function* warnMaybe(): Saga<void> {
    const maximumLayerCountToRender = yield* select(
      state => state.temporaryConfiguration.gpuSetup.maximumLayerCountToRender,
    );

    const enabledLayerCount = yield* select(state => {
      const colorLayerCount = getEnabledColorLayers(state.dataset, state.datasetConfiguration)
        .length;
      const enabledSegmentationCount = isSegmentationLayerEnabled(
        state.dataset,
        state.datasetConfiguration,
      )
        ? 1
        : 0;
      return colorLayerCount + enabledSegmentationCount;
    });

    if (enabledLayerCount > maximumLayerCountToRender) {
      Toast.error(messages["webgl.too_many_active_layers"]({ maximumLayerCountToRender }), {
        sticky: true,
        key: "TOO_MANY_ACTIVE_LAYERS",
      });
    } else {
      Toast.close("TOO_MANY_ACTIVE_LAYERS");
    }
  }

  yield _takeEvery(["WK_READY", "UPDATE_LAYER_SETTING", "UPDATE_DATASET_SETTING"], warnMaybe);
}
