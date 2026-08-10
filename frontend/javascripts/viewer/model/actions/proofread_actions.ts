import type { AdditionalCoordinate } from "types/api_types";
import type { Vector3 } from "viewer/constants";
import type { Tree } from "viewer/model/types/tree_types";
import type { MappingLevelPreviewStatus, SkeletonTracing } from "viewer/store";

export type ProofreadAtPositionAction = ReturnType<typeof proofreadAtPosition>;
export type ClearProofreadingByProductsAction = ReturnType<typeof clearProofreadingByProducts>;
export type ProofreadMergeAction = ReturnType<typeof proofreadMergeAction>;
export type MinCutAgglomerateAction = ReturnType<typeof minCutAgglomerateAction>;
export type MinCutAgglomerateWithPositionAction = ReturnType<
  typeof minCutAgglomerateWithPositionAction
>;
export type ToggleSegmentInPartitionAction = ReturnType<typeof toggleSegmentInPartitionAction>;
export type CutAgglomerateFromNeighborsAction = ReturnType<
  typeof cutAgglomerateFromNeighborsAction
>;
type ResetMultiCutToolPartitionsAction = ReturnType<typeof resetMultiCutToolPartitionsAction>;
export type MinCutPartitionsAction = ReturnType<typeof minCutPartitionsAction>;
export type SetMappingLevelPreviewTargetAction = ReturnType<
  typeof setMappingLevelPreviewTargetAction
>;
export type InitializeMappingLevelPreviewSkeletonAction = ReturnType<
  typeof initializeMappingLevelPreviewSkeletonAction
>;
export type SetMappingLevelPreviewSkeletonAction = ReturnType<
  typeof setMappingLevelPreviewSkeletonAction
>;
export type SetMappingLevelPreviewStatusAction = ReturnType<
  typeof setMappingLevelPreviewStatusAction
>;
export type ClearMappingLevelPreviewAction = ReturnType<typeof clearMappingLevelPreviewAction>;
export type CommitMappingLevelPreviewAction = ReturnType<typeof commitMappingLevelPreviewAction>;

export type ProofreadAction =
  | ProofreadAtPositionAction
  | ClearProofreadingByProductsAction
  | ProofreadMergeAction
  | MinCutAgglomerateAction
  | MinCutAgglomerateWithPositionAction
  | CutAgglomerateFromNeighborsAction
  | ToggleSegmentInPartitionAction
  | ResetMultiCutToolPartitionsAction
  | MinCutPartitionsAction
  | SetMappingLevelPreviewTargetAction
  | InitializeMappingLevelPreviewSkeletonAction
  | SetMappingLevelPreviewSkeletonAction
  | SetMappingLevelPreviewStatusAction
  | ClearMappingLevelPreviewAction
  | CommitMappingLevelPreviewAction;

export const proofreadAtPosition = (
  position: Vector3,
  additionalCoordinates?: AdditionalCoordinate[],
) =>
  ({
    type: "PROOFREAD_AT_POSITION",
    position,
    additionalCoordinates,
  }) as const;

export const clearProofreadingByProducts = () =>
  ({
    type: "CLEAR_PROOFREADING_BY_PRODUCTS",
  }) as const;

export const proofreadMergeAction = (
  position: Vector3 | null, // the clicked target position (if data viewports were used)
  segmentId?: number | null, // the target segment id (if 3D viewport was used)
  agglomerateId?: number | null, // the target agglomerate id (if 3D viewport was used)
) =>
  // Note that the source ID is derived by the active segment ID and is NOT encoded in this action.
  ({
    type: "PROOFREAD_MERGE",
    position,
    segmentId,
    agglomerateId,
  }) as const;

export const minCutAgglomerateAction = (sourceNodeId: number, targetNodeId: number) =>
  ({
    type: "MIN_CUT_AGGLOMERATE_WITH_NODE_IDS",
    sourceNodeId,
    targetNodeId,
  }) as const;

export const minCutAgglomerateWithPositionAction = (
  // This action encodes which target supervoxel should be cut off from the
  // "active supervoxel" (that is marked by the proofreading marker).
  // Either, provide the target via the clicked position...
  position: Vector3 | null,
  // ...or specify the unmapped and mapped id of the clicked supervoxel
  segmentId?: number | null,
  agglomerateId?: number | null,
) =>
  ({
    type: "MIN_CUT_AGGLOMERATE",
    position,
    segmentId,
    agglomerateId,
  }) as const;

export const cutAgglomerateFromNeighborsAction = (
  position: Vector3 | null,
  tree?: Tree | null,
  segmentId?: number | null,
  agglomerateId?: number | null,
) =>
  ({
    type: "CUT_AGGLOMERATE_FROM_NEIGHBORS",
    position,
    tree,
    segmentId,
    agglomerateId,
  }) as const;

export const toggleSegmentInPartitionAction = (
  unmappedSegmentId: number,
  partition: 1 | 2,
  agglomerateId: number,
) =>
  ({
    type: "TOGGLE_SEGMENT_IN_PARTITION",
    unmappedSegmentId,
    partition,
    agglomerateId,
  }) as const;

export const resetMultiCutToolPartitionsAction = () =>
  ({
    type: "RESET_MULTI_CUT_TOOL_PARTITIONS",
  }) as const;

export const minCutPartitionsAction = () =>
  ({
    type: "MIN_CUT_PARTITIONS",
  }) as const;

// --- Per-agglomerate mapping-level preview subtool (see SPIKE-per-agglomerate-mapping-level.md) ---

// User picked a new preview target (target mapping level). The saga resolves the anchor supervoxel from the active
// segment/marker and fetches the preview skeleton.
export const setMappingLevelPreviewTargetAction = (targetMappingName: string) =>
  ({
    type: "SET_MAPPING_LEVEL_PREVIEW_TARGET",
    targetMappingName,
  }) as const;

// Seeds an empty ephemeral preview skeleton so the three.js Skeleton is initialized before any data arrives
// (the Skeleton class does not support a null tracing). Mirrors initializeConnectomeTracingAction.
export const initializeMappingLevelPreviewSkeletonAction = () =>
  ({
    type: "INITIALIZE_MAPPING_LEVEL_PREVIEW_SKELETON",
  }) as const;

// Dispatched by the saga once the preview skeleton for the current target has been fetched.
export const setMappingLevelPreviewSkeletonAction = (skeleton: SkeletonTracing | null) =>
  ({
    type: "SET_MAPPING_LEVEL_PREVIEW_SKELETON",
    skeleton,
  }) as const;

export const setMappingLevelPreviewStatusAction = (status: MappingLevelPreviewStatus) =>
  ({
    type: "SET_MAPPING_LEVEL_PREVIEW_STATUS",
    status,
  }) as const;

// Clears the preview state and removes the ephemeral skeleton (cancel / tool switch / anchor change).
export const clearMappingLevelPreviewAction = () =>
  ({
    type: "CLEAR_MAPPING_LEVEL_PREVIEW",
  }) as const;

// Commits the currently previewed mapping level for the anchor segment (handled by the saga).
export const commitMappingLevelPreviewAction = () =>
  ({
    type: "COMMIT_MAPPING_LEVEL_PREVIEW",
  }) as const;
