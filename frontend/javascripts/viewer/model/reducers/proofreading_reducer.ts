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
      const layerData = state.localSegmentationStateByLayer[layerName];
      if (!layerData?.minCutPartitions) {
        return state;
      }
      const minCutPartitions = layerData.minCutPartitions;
      const otherPartitionIndex = action.partition === "partitionA" ? "partitionB" : "partitionA";
      const actionAgglomerateId = action.agglomerateId;
      const actionUnmappedSegmentId = action.unmappedSegmentId;
      if (
        minCutPartitions.agglomerateId != null &&
        minCutPartitions.agglomerateId !== actionAgglomerateId
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
                  $set: [actionUnmappedSegmentId],
                },
                [otherPartitionIndex]: {
                  $set: [],
                },
                agglomerateId: {
                  $set: actionAgglomerateId,
                },
              },
            },
          },
        });
      }
      const partition = minCutPartitions[action.partition];
      const updatedPartition = partition.includes(actionUnmappedSegmentId)
        ? partition.filter((s) => s !== actionUnmappedSegmentId)
        : partition.concat(actionUnmappedSegmentId);
      const otherPartitionWithoutSegment = minCutPartitions[otherPartitionIndex].filter(
        (s) => s !== actionUnmappedSegmentId,
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
              partitionA: {
                $set: [],
              },
              partitionB: {
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

    case "SET_MULTI_CUT_AGGLOMERATE_ID": {
      const layerData = state.localSegmentationStateByLayer[layerName];
      // Only update the id while a selection exists.
      if (!layerData?.minCutPartitions || layerData.minCutPartitions.agglomerateId == null) {
        return state;
      }
      return update(state, {
        localSegmentationStateByLayer: {
          [layerName]: {
            minCutPartitions: {
              agglomerateId: {
                $set: action.agglomerateId,
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
