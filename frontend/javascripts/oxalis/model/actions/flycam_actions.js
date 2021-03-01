// @flow
import type { Vector3, OrthoView } from "oxalis/constants";

type ZoomInAction = { type: "ZOOM_IN" };
type ZoomOutAction = { type: "ZOOM_OUT" };
type ZoomByDeltaAction = { type: "ZOOM_BY_DELTA", zoomDelta: number };
type SetZoomStepAction = { type: "SET_ZOOM_STEP", zoomStep: number };
type SetPositionAction = { type: "SET_POSITION", position: Vector3, dimensionToSkip: ?number };
type SetRotationAction = { type: "SET_ROTATION", rotation: Vector3 };
type SetDirectionAction = { type: "SET_DIRECTION", direction: Vector3 };
type MoveFlycamOrthoAction = {
  type: "MOVE_FLYCAM_ORTHO",
  vector: Vector3,
  planeId: ?OrthoView,
  clampToEdge: boolean,
};
type MovePlaneFlycamOrthoAction = {
  type: "MOVE_PLANE_FLYCAM_ORTHO",
  vector: Vector3,
  planeId: OrthoView,
  increaseSpeedWithZoom: boolean,
};
type MoveFlycamAction = { type: "MOVE_FLYCAM", vector: Vector3 };
type YawFlycamAction = { type: "YAW_FLYCAM", angle: number, regardDistance: boolean };
type RollFlycamAction = { type: "ROLL_FLYCAM", angle: number, regardDistance: boolean };
type PitchFlycamAction = { type: "PITCH_FLYCAM", angle: number, regardDistance: boolean };
type RotateFlycamAction = {
  type: "ROTATE_FLYCAM",
  angle: number,
  axis: Vector3,
  regardDistance: boolean,
};

export type FlycamAction =
  | ZoomInAction
  | ZoomOutAction
  | ZoomByDeltaAction
  | SetZoomStepAction
  | SetPositionAction
  | SetRotationAction
  | SetDirectionAction
  | MoveFlycamAction
  | MoveFlycamOrthoAction
  | MovePlaneFlycamOrthoAction
  | YawFlycamAction
  | RollFlycamAction
  | PitchFlycamAction
  | RotateFlycamAction;

export const FlycamActions = [
  "ZOOM_IN",
  "ZOOM_OUT",
  "ZOOM_BY_DELTA",
  "SET_ZOOM_STEP",
  "SET_POSITION",
  "SET_ROTATION",
  "SET_DIRECTION",
  "MOVE_FLYCAM_ORTHO",
  "MOVE_PLANE_FLYCAM_ORTHO",
  "MOVE_FLYCAM",
  "YAW_FLYCAM",
  "ROLL_FLYCAM",
  "PITCH_FLYCAM",
  "ROTATE_FLYCAM",
];

export const zoomInAction = (): ZoomInAction => ({ type: "ZOOM_IN" });
export const zoomOutAction = (): ZoomOutAction => ({ type: "ZOOM_OUT" });
export const zoomByDeltaAction = (zoomDelta: number): ZoomByDeltaAction => ({
  type: "ZOOM_BY_DELTA",
  zoomDelta,
});
export const setZoomStepAction = (zoomStep: number): SetZoomStepAction => ({
  type: "SET_ZOOM_STEP",
  zoomStep,
});
export const setPositionAction = (
  position: Vector3,
  dimensionToSkip: ?number,
): SetPositionAction => ({
  type: "SET_POSITION",
  position,
  dimensionToSkip,
});
export const setRotationAction = (rotation: Vector3): SetRotationAction => ({
  type: "SET_ROTATION",
  rotation,
});
export const setDirectionAction = (direction: Vector3): SetDirectionAction => ({
  type: "SET_DIRECTION",
  direction,
});
export const moveFlycamOrthoAction = (
  vector: Vector3,
  planeId: ?OrthoView,
  // If clampToEdge is true, the z coordinate is clamped to the edge (either .0 or 0.999)
  // so that subsequent, fractional movements go from .0 to .999 (or the other way round).
  // Only works if planeId is provided.
  clampToEdge: boolean = false,
): MoveFlycamOrthoAction => ({ type: "MOVE_FLYCAM_ORTHO", vector, planeId, clampToEdge });
export const movePlaneFlycamOrthoAction = (
  vector: Vector3,
  planeId: OrthoView,
  increaseSpeedWithZoom?: boolean = true,
): MovePlaneFlycamOrthoAction => ({
  type: "MOVE_PLANE_FLYCAM_ORTHO",
  vector,
  planeId,
  increaseSpeedWithZoom,
});
export const moveFlycamAction = (vector: Vector3): MoveFlycamAction => ({
  type: "MOVE_FLYCAM",
  vector,
});
export const yawFlycamAction = (
  angle: number,
  regardDistance?: boolean = false,
): YawFlycamAction => ({ type: "YAW_FLYCAM", angle, regardDistance });
export const rollFlycamAction = (
  angle: number,
  regardDistance?: boolean = false,
): RollFlycamAction => ({ type: "ROLL_FLYCAM", angle, regardDistance });
export const pitchFlycamAction = (
  angle: number,
  regardDistance?: boolean = false,
): PitchFlycamAction => ({ type: "PITCH_FLYCAM", angle, regardDistance });
export const rotateFlycamAction = (
  angle: number,
  axis: Vector3,
  regardDistance?: boolean = false,
): RotateFlycamAction => ({ type: "ROTATE_FLYCAM", angle, axis, regardDistance });
