import { Vector3 } from "oxalis/constants";

export type ProofreadAtPositionAction = {
  type: "PROOFREAD_AT_POSITION";
  position: Vector3;
};

export type ProofreadAction = ProofreadAtPositionAction;

export const proofreadAtPosition = (position: Vector3): ProofreadAtPositionAction => ({
  type: "PROOFREAD_AT_POSITION",
  position,
});
