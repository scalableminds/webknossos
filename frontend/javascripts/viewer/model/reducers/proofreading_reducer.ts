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
      const otherPartitionIndex = action.partition === 1 ? 2 : 1;
      if (minCutPartitions.agglomerateId !== action.agglomerateId) {
        // TODOM: Discuss whether to instead ignore the action and show an error toast that the new segment does not belong to the same agglomerate.
        return update(state, {
          localSegmentationData: {
            [layerName]: {
              minCutPartitions: {
                [action.partition]: {
                  $set: [action.unmappedSegmentId],
                },
                [otherPartitionIndex]: {
                  $set: [],
                },
                agglomerateId: {
                  $set: action.agglomerateId,
                },
              },
            },
          },
        });
      }
      const partition = minCutPartitions[action.partition];
      const updatedPartition = partition.includes(action.unmappedSegmentId)
        ? partition.filter((s) => s !== action.unmappedSegmentId)
        : partition.concat(action.unmappedSegmentId);
      const otherPartitionWithoutSegment = minCutPartitions[otherPartitionIndex].filter(
        (s) => s !== action.unmappedSegmentId,
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
