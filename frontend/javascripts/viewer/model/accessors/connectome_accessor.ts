import type { APIDataLayer, APIDataset } from "types/api_types";
import type { WebknossosState } from "viewer/store";
import { getVisibleOrLastSegmentationLayer } from "./dataset_accessor";

const CONNECTOME_STATES = {
  NO_SEGMENTATION: {
    value: false,
    reason: "A segmentation layer needs to be visible to load the synapses of a segment.",
  },
  NO_CONNECTOME_FILE: {
    value: false,
    reason: "A connectome file needs to be available to load the synapses of a segment.",
  },
  YES: {
    value: true,
    reason: "",
  },
};

export function getConnectomeDataForLayer(state: WebknossosState, layerName: string) {
  return state.localSegmentationStateByLayer[layerName].connectomeData;
}

function hasConnectomeAttachment(layer: APIDataLayer | null | undefined): boolean {
  if (layer == null) return false;
  if ((layer.attachments?.connectomes?.length ?? 0) > 0) return true;
  // Volume annotation layers replace their fallback layer, which holds the attachments.
  return layer.category === "segmentation" && hasConnectomeAttachment(layer.fallbackLayerInfo);
}

export function datasetHasConnectomes(dataset: APIDataset): boolean {
  return dataset.dataSource.dataLayers.some(hasConnectomeAttachment);
}

export function hasConnectomeFile(state: WebknossosState) {
  const segmentationLayer = getVisibleOrLastSegmentationLayer(state);

  if (segmentationLayer == null) {
    return CONNECTOME_STATES.NO_SEGMENTATION;
  }

  const { currentConnectomeFile } = getConnectomeDataForLayer(state, segmentationLayer.name);

  if (currentConnectomeFile == null) {
    return CONNECTOME_STATES.NO_CONNECTOME_FILE;
  }

  return CONNECTOME_STATES.YES;
}
