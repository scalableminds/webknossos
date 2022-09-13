import { Vector3 } from "oxalis/constants";

export type ProofreadAtPositionAction = ReturnType<typeof proofreadAtPosition>;
export type ClearProofreadingByProductsAction = ReturnType<typeof clearProofreadingByProducts>;
export type ProofreadMergeAction = ReturnType<typeof proofreadMerge>;
export type ProofreadSplitAction = ReturnType<typeof proofreadSplit>;

export type ProofreadAction =
  | ProofreadAtPositionAction
  | ClearProofreadingByProductsAction
  | ProofreadSplitAction;

export const proofreadAtPosition = (position: Vector3) =>
  ({
    type: "PROOFREAD_AT_POSITION",
    position,
  } as const);

export const clearProofreadingByProducts = () =>
  ({
    type: "CLEAR_PROOFREADING_BY_PRODUCTS",
  } as const);

export const proofreadMerge = (position: Vector3) =>
  ({
    type: "PROOFREAD_MERGE",
    position,
  } as const);

export const proofreadSplit = (position: Vector3) =>
  ({
    type: "PROOFREAD_SPLIT",
    position,
  } as const);
