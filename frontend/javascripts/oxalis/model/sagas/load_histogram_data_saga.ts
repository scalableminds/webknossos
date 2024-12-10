import type { Saga } from "oxalis/model/sagas/effect-generators";
import { select } from "oxalis/model/sagas/effect-generators";
import { call, takeEvery, put } from "typed-redux-saga";
import {
  setHistogramDataForLayerAction,
  updateLayerSettingAction,
  type ReloadHistogramAction,
} from "oxalis/model/actions/settings_actions";
import { getHistogramForLayer } from "admin/admin_rest_api";
import type DataLayer from "oxalis/model/data_layer";
import { Model } from "oxalis/singletons";
import type { Vector2 } from "oxalis/constants";
import { ensureWkReady } from "./ready_sagas";

export default function* loadHistogramDataSaga(): Saga<void> {
  yield* call(ensureWkReady);
  yield* takeEvery("RELOAD_HISTOGRAM", reloadHistogramForLayer);

  const dataLayers: Array<DataLayer> = yield* call([Model, Model.getColorLayers]);
  for (const dataLayer of dataLayers) {
    const layerName = dataLayer.name;
    // We send the histogram data requests sequentially so there is less blockage of bucket data requests.
    yield* call(loadHistogramForLayer, layerName);
  }
}

function* reloadHistogramForLayer(action: ReloadHistogramAction): Saga<void> {
  const { layerName } = action;
  // Set histogram to undefined to indicate that it is being reloaded
  yield* put(setHistogramDataForLayerAction(layerName, undefined));
  yield* call(loadHistogramForLayer, layerName);
}

function* loadHistogramForLayer(layerName: string): Saga<void> {
  const dataset = yield* select((state) => state.dataset);
  const currentLayerConfig = yield* select((state) => state.datasetConfiguration.layers[layerName]);

  let histogram;
  try {
    histogram = yield* call(getHistogramForLayer, dataset.dataStore.url, dataset, layerName);

    if (!Array.isArray(histogram) || histogram.length === 0) {
      yield* put(setHistogramDataForLayerAction(layerName, null));
      return;
    }
  } catch (e) {
    console.warn(`Error: Could not fetch the histogram data for layer ${layerName}.`, e);
    yield* put(setHistogramDataForLayerAction(layerName, null));
    return;
  }

  // Adjust the intensityRange of the layer to be within the range of the actual (sampled) data.
  const allMinValues = histogram.map((currentHistogramData) => currentHistogramData.min);
  const allMaxValues = histogram.map((currentHistogramData) => currentHistogramData.max);
  const minimumInHistogramData = Math.min(...allMinValues);
  const maximumInHistogramData = Math.max(...allMaxValues);
  let newIntensityRange: Vector2 = [0, 0];

  if (currentLayerConfig) {
    // The intensityRange is the range where the color value will be clamped to
    // while min/max are the value range of the histogram slider.
    // The following keeps the intensityRange within the min and max bounds if they exist.
    // If they do not exist the tracing / dataset has never been opened and thus the histogram data is used as a default range delimiter.
    newIntensityRange = [
      Math.max(
        currentLayerConfig.intensityRange != null
          ? currentLayerConfig.intensityRange[0]
          : minimumInHistogramData,
        currentLayerConfig.min != null ? currentLayerConfig.min : minimumInHistogramData,
      ),
      Math.min(
        currentLayerConfig.intensityRange != null
          ? currentLayerConfig.intensityRange[1]
          : maximumInHistogramData,
        currentLayerConfig.max != null ? currentLayerConfig.max : maximumInHistogramData,
      ),
    ];
  } else {
    newIntensityRange = [minimumInHistogramData, maximumInHistogramData];
  }

  yield* put(updateLayerSettingAction(layerName, "intensityRange", newIntensityRange));

  // Here we also set the minimum and maximum values for the intensity range that the user can enter.
  // If values already exist, we skip this step.
  if (currentLayerConfig == null || currentLayerConfig.min == null) {
    yield* put(updateLayerSettingAction(layerName, "min", minimumInHistogramData));
  }

  if (currentLayerConfig == null || currentLayerConfig.max == null) {
    yield* put(updateLayerSettingAction(layerName, "max", maximumInHistogramData));
  }

  yield* put(setHistogramDataForLayerAction(layerName, histogram));
}
