/* eslint-disable import/prefer-default-export */
// @flow
import type { Vector3, OrthoViewType } from "oxalis/constants";

type ZoomInActionType = { type: "ZOOM_IN" };
type ZoomOutActionType = { type: "ZOOM_OUT" };
type ZoomByDeltaActionType = { type: "ZOOM_BY_DELTA", zoomDelta: number };
type SetZoomStepActionType = { type: "SET_ZOOM_STEP", zoomStep: number };
type SetPositionActionType = { type: "SET_POSITION", position: Vector3 };
type SetRotationActionType = { type: "SET_ROTATION", rotation: Vector3 };
type MoveFlycamOrthoActionType = { type: "MOVE_FLYCAM_ORTHO", vector: Vector3, planeId: ?OrthoViewType };
type MovePlaneFlycamOrthoActionType = {
  type: "MOVE_PLANE_FLYCAM_ORTHO",
  vector: Vector3,
  planeId: OrthoViewType,
  increaseSpeedWithZoom: boolean,
};
type MoveFlycamActionType = { type: "MOVE_FLYCAM", vector: Vector3 };
type YawFlycamActionType = { type: "YAW_FLYCAM", angle: number, regardDistance: boolean };
type RollFlycamActionType = { type: "ROLL_FLYCAM", angle: number, regardDistance: boolean };
type PitchFlycamActionType = { type: "PITCH_FLYCAM", angle: number, regardDistance: boolean };
type RotateFlycamActionType = { type: "ROTATE_FLYCAM", angle: number, axis: Vector3, regardDistance: boolean };

export type Flycam3DActionType =
  | ZoomInActionType
  | ZoomOutActionType
  | ZoomByDeltaActionType
  | SetZoomStepActionType
  | SetPositionActionType
  | SetRotationActionType
  | MoveFlycamActionType
  | MoveFlycamOrthoActionType
  | MovePlaneFlycamOrthoActionType
  | YawFlycamActionType
  | RollFlycamActionType
  | PitchFlycamActionType
  | RotateFlycamActionType;

export const Flycam3DActions = [
  "ZOOM_IN",
  "ZOOM_OUT",
  "ZOOM_BY_DELTA",
  "SET_ZOOM_STEP",
  "SET_POSITION",
  "SET_ROTATION",
  "MOVE_FLYCAM_ORTHO",
  "MOVE_PLANE_FLYCAM_ORTHO",
  "MOVE_FLYCAM",
  "YAW_FLYCAM",
  "ROLL_FLYCAM",
  "PITCH_FLYCAM",
  "ROTATE_FLYCAM",
];

export const zoomInAction = (): ZoomInActionType => ({ type: "ZOOM_IN" });
export const zoomOutAction = (): ZoomOutActionType => ({ type: "ZOOM_OUT" });
export const zoomByDeltaAction = (zoomDelta: number): ZoomByDeltaActionType =>
  ({ type: "ZOOM_BY_DELTA", zoomDelta });
export const setZoomStepAction = (zoomStep: number): SetZoomStepActionType =>
  ({ type: "SET_ZOOM_STEP", zoomStep });
export const setPositionAction = (position: Vector3): SetPositionActionType =>
  ({ type: "SET_POSITION", position });
export const setRotationAction = (rotation: Vector3): SetRotationActionType =>
  ({ type: "SET_ROTATION", rotation });
export const moveFlycamOrthoAction = (vector: Vector3, planeId: ?OrthoViewType): MoveFlycamOrthoActionType =>
  ({ type: "MOVE_FLYCAM_ORTHO", vector, planeId });
export const movePlaneFlycamOrthoAction = (
  vector: Vector3,
  planeId: OrthoViewType,
  increaseSpeedWithZoom?: boolean = true,
): MovePlaneFlycamOrthoActionType =>
  ({ type: "MOVE_PLANE_FLYCAM_ORTHO", vector, planeId, increaseSpeedWithZoom });
export const moveFlycamAction = (vector: Vector3): MoveFlycamActionType =>
  ({ type: "MOVE_FLYCAM", vector });
export const yawFlycamAction = (angle: number, regardDistance?: boolean = false): YawFlycamActionType =>
  ({ type: "YAW_FLYCAM", angle, regardDistance });
export const rollFlycamAction = (angle: number, regardDistance?: boolean = false): RollFlycamActionType =>
  ({ type: "ROLL_FLYCAM", angle, regardDistance });
export const pitchFlycamAction = (angle: number, regardDistance?: boolean = false): PitchFlycamActionType =>
  ({ type: "PITCH_FLYCAM", angle, regardDistance });
export const rotateFlycamAction = (angle: number, axis: Vector3, regardDistance?: boolean = false): RotateFlycamActionType =>
  ({ type: "ROTATE_FLYCAM", angle, axis, regardDistance });
