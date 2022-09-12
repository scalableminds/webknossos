import { Vector3 } from "oxalis/constants";

export type ProofreadAtPositionAction = ReturnType<typeof proofreadAtPosition>;
export type ClearProofReadingByProductsAction = ReturnType<typeof clearProofReadingByProducts>;

export type ProofreadAction = ProofreadAtPositionAction | ClearProofReadingByProductsAction;

export const proofreadAtPosition = (position: Vector3) =>
  ({
    type: "PROOFREAD_AT_POSITION",
    position,
  } as const);

export const clearProofReadingByProducts = () =>
  ({
    type: "CLEAR_PROOF_READING_BY_PRODUCTS",
  } as const);
