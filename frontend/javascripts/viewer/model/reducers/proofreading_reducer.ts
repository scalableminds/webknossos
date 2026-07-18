import update from "immutability-helper";
import { getVisibleSegmentationLayer } from "viewer/model/accessors/dataset_accessor";
import type { WebknossosState } from "viewer/store";
import type { ProofreadAction } from "../actions/proofread_actions";

const HANDLED_ACTION_TYPES = new Set([
  "TOGGLE_SEGMENT_IN_PARTITION",
  "RESET_MULTI_CUT_TOOL_PARTITIONS",
]);

function ProofreadingReducer(state: WebknossosState, action: ProofreadAction): WebknossosState {
  if (!HANDLED_ACTION_TYPES.has(action.type)) {
    // Check the action type before resolving the visible segmentation layer, as
    // this reducer runs for every dispatched action.
    return state;
  }
  const visibleSegmentationLayer = getVisibleSegmentationLayer(state);
  const layerName = visibleSegmentationLayer?.name;
  if (!layerName) {
    return state;
  }
  switch (action.type) {
    case "TOGGLE_SEGMENT_IN_PARTITION": {
      const layerData = state.localSegmentationStateByLayer[layerName];
      if (!layerData || !layerData.minCutPartitions) {
        return state;
      }
      const minCutPartitions = layerData.minCutPartitions;
      const otherPartitionIndex = action.partition === 1 ? 2 : 1;
      if (
        minCutPartitions.agglomerateId != null &&
        minCutPartitions.agglomerateId !== action.agglomerateId
      ) {
        // Ignore the action if the selected agglomerate ids do not match.
        // The proofread saga will show an info toast in this case.
        return state;
      } else if (minCutPartitions.agglomerateId == null) {
        return update(state, {
          localSegmentationStateByLayer: {
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
        localSegmentationStateByLayer: {
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
        localSegmentationStateByLayer: {
          [layerName]: {
            minCutPartitions: {
              [1]: {
                $set: [],
              },
              [2]: {
                $set: [],
              },
              agglomerateId: {
                $set: null,
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
