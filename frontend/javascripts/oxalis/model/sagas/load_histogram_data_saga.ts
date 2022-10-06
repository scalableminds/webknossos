import type { HistogramDataForAllLayers, DatasetLayerConfiguration } from "oxalis/store";
import type { Saga } from "oxalis/model/sagas/effect-generators";
import { select } from "oxalis/model/sagas/effect-generators";
import { call, take, takeEvery, put } from "typed-redux-saga";
import {
  setHistogramDataAction,
  setHistogramDataForLayerAction,
  updateLayerSettingAction,
  type ReloadHistogramAction,
} from "oxalis/model/actions/settings_actions";
import { getHistogramForLayer } from "admin/admin_rest_api";
import DataLayer from "oxalis/model/data_layer";
import Model from "oxalis/model";
import type { APIHistogramData } from "types/api_flow_types";

export default function* loadHistogramDataSaga(): Saga<void> {
  yield* take("WK_READY");
  yield* takeEvery("RELOAD_HISTOGRAM", reloadHistogramForLayer);
  const dataLayers: Array<DataLayer> = yield* call([Model, Model.getColorLayers]) as any;
  const layerConfigurations = yield* select((state) => state.datasetConfiguration.layers);

  const histograms: HistogramDataForAllLayers = {};
  for (const dataLayer of dataLayers) {
    const layerName = dataLayer.name;
    // We send the histogram data requests sequentially so there is less blockage of bucket data requests.
    const histogram = yield* call(loadHistogramForLayer, layerName, layerConfigurations[layerName]);
    if (histogram != null) histograms[layerName] = histogram;
  }

  yield* put(setHistogramDataAction(histograms));
}

function* reloadHistogramForLayer(action: ReloadHistogramAction): Saga<void> {
  const { layerName } = action;
  const layerConfigurations = yield* select((state) => state.datasetConfiguration.layers);

  const histogram = yield* call(loadHistogramForLayer, layerName, layerConfigurations[layerName]);
  // Also update histogram data if it is undefined since apparently it can no longer be generated
  yield* put(setHistogramDataForLayerAction(layerName, histogram));
}

function* loadHistogramForLayer(
  layerName: string,
  currentLayerConfig: DatasetLayerConfiguration,
): Saga<APIHistogramData | undefined> {
  const dataset = yield* select((state) => state.dataset);

  let histogram;
  try {
    histogram = yield* call(getHistogramForLayer, dataset.dataStore.url, dataset, layerName);

    if (!Array.isArray(histogram) || histogram.length === 0) {
      return undefined;
    }
  } catch (e) {
    console.warn(`Error: Could not fetch the histogram data for layer ${layerName}.`, e);
    return undefined;
  }

  // Adjust the intensityRange of the layer to be within the range of the actual (sampled) data.
  const allMinValues = histogram.map((currentHistogramData) => currentHistogramData.min);
  const allMaxValues = histogram.map((currentHistogramData) => currentHistogramData.max);
  const minimumInHistogramData = Math.min(...allMinValues);
  const maximumInHistogramData = Math.max(...allMaxValues);
  let newIntensityRange = [];

  if (currentLayerConfig) {
    // The intensityRange is the range where the color value will be clamped to
    // while min/max are the value range of the histogram slider.
    // The following keeps the intensityRange within the min and max bounds if they exist.
    // If they do not exist the tracing / dataset has never been opened and thus the histogram data is used as a default range delimiter.
    newIntensityRange = [
      Math.max(
        currentLayerConfig.intensityRange[0],
        currentLayerConfig.min != null ? currentLayerConfig.min : minimumInHistogramData,
      ),
      Math.min(
        currentLayerConfig.intensityRange[1],
        currentLayerConfig.max != null ? currentLayerConfig.max : maximumInHistogramData,
      ),
    ];
  } else {
    newIntensityRange = [minimumInHistogramData, maximumInHistogramData];
  }

  yield* put(updateLayerSettingAction(layerName, "intensityRange", newIntensityRange));

  // Here we also set the minium and maximum values for the intensity range that the user can enter.
  // If values already exist, we skip this step.
  if (currentLayerConfig == null || currentLayerConfig.min == null) {
    yield* put(updateLayerSettingAction(layerName, "min", minimumInHistogramData));
  }

  if (currentLayerConfig == null || currentLayerConfig.max == null) {
    yield* put(updateLayerSettingAction(layerName, "max", maximumInHistogramData));
  }

  return histogram;
}
