import update from "immutability-helper";
import { getVisibleSegmentationLayer } from "viewer/model/accessors/dataset_accessor";
import type { WebknossosState } from "viewer/store";
import type { ProofreadAction } from "../actions/proofread_actions";

function ProofreadingReducer(state: WebknossosState, action: ProofreadAction): WebknossosState {
  switch (action.type) {
    case "TOGGLE_SEGMENT_IN_PARTITION": {
      const visibleSegmentationLayer = getVisibleSegmentationLayer(state);
      const layerName = visibleSegmentationLayer?.name;
      if (!layerName) {
        return state;
      }
      const partition = state.localSegmentationData[layerName].mincutPartitions[action.partition];
      const updatedParition = partition.includes(action.segmentId)
        ? partition.filter((s) => s !== action.segmentId)
        : partition.concat(action.segmentId);

      return update(state, {
        localSegmentationData: {
          [layerName]: {
            mincutPartitions: {
              [action.partition]: {
                $set: updatedParition,
              },
            },
          },
        },
      });
    }

    default:
      return state;
  }
}

export default ProofreadingReducer;
