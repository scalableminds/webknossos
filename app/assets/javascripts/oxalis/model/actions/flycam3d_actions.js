/* eslint-disable import/prefer-default-export */
// @flow
import type { Vector3 } from "oxalis/constants";

type ZoomInActionType = { type: "ZOOM_IN" };
type ZoomOutActionType = { type: "ZOOM_OUT" };
type SetZoomStepActionType = { type: "SET_ZOOM_STEP", zoomStep: number };
type SetPositionActionType = { type: "SET_POSITION", position: Vector3 };
type SetRotationActionType = { type: "SET_ROTATION", rotation: Vector3 };
type MoveFlycamActionType = { type: "MOVE_FLYCAM", vector: Vector3 };
type YawFlycamActionType = { type: "YAW_FLYCAM", angle: number, regardDistance: boolean };
type RollFlycamActionType = { type: "ROLL_FLYCAM", angle: number, regardDistance: boolean };
type PitchFlycamActionType = { type: "PITCH_FLYCAM", angle: number, regardDistance: boolean };
type RotateFlycamActionType = { type: "ROTATE_FLYCAM", angle: number, axis: Vector3, regardDistance: boolean };

export type Flycam3DActionType =
  | ZoomInActionType
  | ZoomOutActionType
  | SetZoomStepActionType
  | SetPositionActionType
  | SetRotationActionType
  | MoveFlycamActionType
  | YawFlycamActionType
  | RollFlycamActionType
  | PitchFlycamActionType
  | RotateFlycamActionType;

export const zoomInAction = (): ZoomInActionType => ({ type: "ZOOM_IN" });
export const zoomOutAction = (): ZoomOutActionType => ({ type: "ZOOM_OUT" });
export const setZoomStepAction = (zoomStep: number): SetZoomStepActionType =>
  ({ type: "SET_ZOOM_STEP", zoomStep });
export const setPositionAction = (position: Vector3): SetPositionActionType =>
  ({ type: "SET_POSITION", position });
export const setRotationAction = (rotation: Vector3): SetRotationActionType =>
  ({ type: "SET_ROTATION", rotation });
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
