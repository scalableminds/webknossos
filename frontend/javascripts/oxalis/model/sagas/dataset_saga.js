// @flow
import { getColorLayers } from "oxalis/model/accessors/dataset_accessor";
import { type Saga, _takeEvery, select } from "oxalis/model/sagas/effect-generators";
import messages from "messages";

// import { type Saga, select, take } from "oxalis/model/sagas/effect-generators";
import Toast from "libs/toast";
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
    const allLayers = yield* select(state => getColorLayers(state.dataset));
    const layerSettings = yield* select(state => state.datasetConfiguration.layers);
    const maximumLayerCountToRender = yield* select(
      state => state.temporaryConfiguration.gpuSetup.maximumLayerCountToRender,
    );

    const enabledLayerCount = allLayers.filter(layer => {
      const settings = layerSettings[layer.name];
      if (settings == null) {
        return false;
      }
      return !settings.isDisabled;
    }).length;

    if (enabledLayerCount > maximumLayerCountToRender) {
      Toast.error(messages["webgl.too_many_active_layers"]({ maximumLayerCountToRender }), {
        sticky: true,
        key: "TOO_MANY_ACTIVE_LAYERS",
      });
    } else {
      Toast.close("TOO_MANY_ACTIVE_LAYERS");
    }
  }

  yield _takeEvery("UPDATE_LAYER_SETTING", warnMaybe);
}
