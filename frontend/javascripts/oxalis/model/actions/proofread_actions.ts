import { Vector3 } from "oxalis/constants";

export type ProofreadAtPositionAction = ReturnType<typeof proofreadAtPosition>;

export type ProofreadAction = ProofreadAtPositionAction;

export const proofreadAtPosition = (position: Vector3) =>
  ({
    type: "PROOFREAD_AT_POSITION",
    position,
  } as const);
