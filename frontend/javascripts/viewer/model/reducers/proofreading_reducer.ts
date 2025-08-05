import update from "immutability-helper";
import { getVisibleSegmentationLayer } from "viewer/model/accessors/dataset_accessor";
import type { WebknossosState } from "viewer/store";
import type { ProofreadAction } from "../actions/proofread_actions";

function ProofreadingReducer(state: WebknossosState, action: ProofreadAction): WebknossosState {
  const visibleSegmentationLayer = getVisibleSegmentationLayer(state);
  const layerName = visibleSegmentationLayer?.name;
  if (!layerName) {
    return state;
  }
  switch (action.type) {
    case "TOGGLE_SEGMENT_IN_PARTITION": {
      const minCutPartitions = state.localSegmentationData[layerName].minCutPartitions;
      const partition = minCutPartitions[action.partition];
      const updatedPartition = partition.includes(action.segmentId)
        ? partition.filter((s) => s !== action.segmentId)
        : partition.concat(action.segmentId);
      const otherPartitionIndex = action.partition === 1 ? 2 : 1;
      const otherPartitionWithoutSegment = minCutPartitions[otherPartitionIndex].filter(
        (s) => s !== action.segmentId,
      );

      return update(state, {
        localSegmentationData: {
          [layerName]: {
            minCutPartitions: {
              [action.partition]: {
                $set: updatedPartition,
              },
              [otherPartitionIndex]: {
                $set: otherPartitionWithoutSegment,
              },
            },
          },
        },
      });
    }

    case "RESET_MULTI_CUT_TOOL_PARTITIONS": {
      return update(state, {
        localSegmentationData: {
          [layerName]: {
            minCutPartitions: {
              [1]: {
                $set: [],
              },
              [2]: {
                $set: [],
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
