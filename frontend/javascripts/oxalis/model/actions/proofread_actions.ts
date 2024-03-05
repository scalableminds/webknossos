import { Vector3 } from "oxalis/constants";
import { type AdditionalCoordinate } from "types/api_flow_types";
import type { Tree } from "oxalis/store";

export type ProofreadAtPositionAction = ReturnType<typeof proofreadAtPosition>;
export type ClearProofreadingByProductsAction = ReturnType<typeof clearProofreadingByProducts>;
export type ProofreadMergeAction = ReturnType<typeof proofreadMerge>;
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

export const proofreadMerge = (position: Vector3) =>
  ({
    type: "PROOFREAD_MERGE",
    position,
  }) as const;

export const minCutAgglomerateAction = (sourceNodeId: number, targetNodeId: number) =>
  ({
    type: "MIN_CUT_AGGLOMERATE",
    sourceNodeId,
    targetNodeId,
  }) as const;

export const minCutAgglomerateWithPositionAction = (position: Vector3) =>
  ({
    type: "MIN_CUT_AGGLOMERATE_WITH_POSITION",
    position,
  }) as const;

export const cutAgglomerateFromNeighborsAction = (position: Vector3, tree?: Tree) =>
  ({
    type: "CUT_AGGLOMERATE_FROM_NEIGHBORS",
    position,
    tree,
  }) as const;
