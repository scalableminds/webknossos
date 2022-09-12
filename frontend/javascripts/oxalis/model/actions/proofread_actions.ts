import { Vector3 } from "oxalis/constants";

export type ProofreadAtPositionAction = ReturnType<typeof proofreadAtPosition>;
export type ClearProofreadingByProductsAction = ReturnType<typeof clearProofreadingByProducts>;

export type ProofreadAction = ProofreadAtPositionAction | ClearProofreadingByProductsAction;

export const proofreadAtPosition = (position: Vector3) =>
  ({
    type: "PROOFREAD_AT_POSITION",
    position,
  } as const);

export const clearProofreadingByProducts = () =>
  ({
    type: "CLEAR_PROOFREADING_BY_PRODUCTS",
  } as const);
