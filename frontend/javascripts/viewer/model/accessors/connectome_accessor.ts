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
