import update from "immutability-helper";
import { getVisibleSegmentationLayer } from "viewer/model/accessors/dataset_accessor";
import { buildEmptyMappingLevelPreviewSkeleton } from "viewer/model/sagas/volume/proofreading/mapping_level_preview_helpers";
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

    case "INITIALIZE_MAPPING_LEVEL_PREVIEW_SKELETON": {
      // Seed an empty (non-null) ephemeral skeleton so the three.js Skeleton is initialized before any data arrives.
      return update(state, {
        localSegmentationStateByLayer: {
          [layerName]: {
            mappingLevelPreviewSkeleton: { $set: buildEmptyMappingLevelPreviewSkeleton() },
          },
        },
      });
    }

    case "SET_MAPPING_LEVEL_PREVIEW_TARGET": {
      // Keep any previously rendered skeleton visible while the new one loads.
      return update(state, {
        localSegmentationStateByLayer: {
          [layerName]: {
            mappingLevelPreview: {
              $set: {
                targetMappingName: action.targetMappingName,
                status: "LOADING",
              },
            },
          },
        },
      });
    }

    case "SET_MAPPING_LEVEL_PREVIEW_SKELETON": {
      const preview = state.localSegmentationStateByLayer[layerName]?.mappingLevelPreview;
      if (preview == null) {
        return state;
      }
      return update(state, {
        localSegmentationStateByLayer: {
          [layerName]: {
            mappingLevelPreview: {
              status: { $set: action.skeleton != null ? "READY" : "IDLE" },
            },
            mappingLevelPreviewSkeleton: { $set: action.skeleton },
          },
        },
      });
    }

    case "SET_MAPPING_LEVEL_PREVIEW_STATUS": {
      const preview = state.localSegmentationStateByLayer[layerName]?.mappingLevelPreview;
      if (preview == null) {
        return state;
      }
      return update(state, {
        localSegmentationStateByLayer: {
          [layerName]: {
            mappingLevelPreview: {
              status: { $set: action.status },
            },
          },
        },
      });
    }

    case "CLEAR_MAPPING_LEVEL_PREVIEW": {
      return update(state, {
        localSegmentationStateByLayer: {
          [layerName]: {
            mappingLevelPreview: { $set: null },
            mappingLevelPreviewSkeleton: { $set: null },
          },
        },
      });
    }

    default:
      return state;
  }
}

export default ProofreadingReducer;
