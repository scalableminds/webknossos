import type { AdditionalCoordinate } from "types/api_types";
import type { Vector3 } from "viewer/constants";
import type { Tree } from "viewer/model/types/tree_types";

export type ProofreadAtPositionAction = ReturnType<typeof proofreadAtPosition>;
export type ClearProofreadingByProductsAction = ReturnType<typeof clearProofreadingByProducts>;
export type ProofreadMergeAction = ReturnType<typeof proofreadMergeAction>;
export type MinCutAgglomerateAction = ReturnType<typeof minCutAgglomerateAction>;
export type MinCutAgglomerateWithPositionAction = ReturnType<
  typeof minCutAgglomerateWithPositionAction
>;
export type CutAgglomerateFromNeighborsAction = ReturnType<
  typeof cutAgglomerateFromNeighborsAction
>;

export type ProofreadAction =
  | ProofreadAtPositionAction
  | ClearProofreadingByProductsAction
  | ProofreadMergeAction
  | MinCutAgglomerateAction
  | MinCutAgglomerateWithPositionAction
  | CutAgglomerateFromNeighborsAction;

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
  segmentId?: number | null, // the target segment id
  agglomerateId?: number | null, // the target agglomerate id
) =>
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
  // This action encodes which target super-voxel should be cut off from the
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
