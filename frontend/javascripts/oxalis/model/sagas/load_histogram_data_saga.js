// @flow
import type { HistogramDataForAllLayers } from "oxalis/store";
import { type Saga, call, select, take, put } from "oxalis/model/sagas/effect-generators";
import {
  setHistogramDataAction,
  updateLayerSettingAction,
} from "oxalis/model/actions/settings_actions";
import { getHistogramForLayer } from "admin/admin_rest_api";
import DataLayer from "oxalis/model/data_layer";
import Model from "oxalis/model";
import type { APIDataset } from "admin/api_flow_types";

async function fetchAllHistogramsForLayers(
  dataLayers: Array<DataLayer>,
  dataset: APIDataset,
): Promise<HistogramDataForAllLayers> {
  const histograms: HistogramDataForAllLayers = {};
  const histogramPromises = dataLayers.map(async dataLayer => {
    try {
      const data = await getHistogramForLayer(dataset.dataStore.url, dataset, dataLayer.name);
      histograms[dataLayer.name] = data;
    } catch (e) {
      console.warn(`Error: Could not fetch the hisogram data for layer ${dataLayer.name}.`, e);
    }
  });
  await Promise.all(histogramPromises);
  return histograms;
}

export function* loadHistorgramData(): Saga<void> {
  yield* take("WK_READY");
  const dataLayers = yield* call([Model, Model.getColorLayers]);
  const dataset = yield* select(state => state.dataset);
  const layerConfigurations = yield* select(state => state.datasetConfiguration.layers);
  const histograms = yield* call(fetchAllHistogramsForLayers, dataLayers, dataset);

  for (const layerName of Object.keys(histograms)) {
    // Adjust the intensityRange of the layer to be within the range of the actual (sampled) data.
    const histogram = histograms[layerName];
    const allMinValues = histogram.map(currentHistogramData => currentHistogramData.min);
    const allMaxValues = histogram.map(currentHistogramData => currentHistogramData.max);
    const minimumInHistogramData = Math.min(...allMinValues);
    const maximumInHistogramData = Math.max(...allMaxValues);
    let newIntensityRange = [];
    if (layerConfigurations[layerName]) {
      newIntensityRange = [
        Math.max(layerConfigurations[layerName].intensityRange[0], minimumInHistogramData),
        Math.min(layerConfigurations[layerName].intensityRange[1], maximumInHistogramData),
      ];
    } else {
      newIntensityRange = [minimumInHistogramData, maximumInHistogramData];
    }
    yield* put(updateLayerSettingAction(layerName, "intensityRange", newIntensityRange));
  }
  yield* put(setHistogramDataAction(histograms));
}

export default {};
