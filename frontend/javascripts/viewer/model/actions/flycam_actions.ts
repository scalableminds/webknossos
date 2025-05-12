import type { AdditionalCoordinate } from "types/api_types";
import type { OrthoView, Vector3 } from "viewer/constants";

type ZoomInAction = ReturnType<typeof zoomInAction>;
type ZoomOutAction = ReturnType<typeof zoomOutAction>;
type ZoomByDeltaAction = ReturnType<typeof zoomByDeltaAction>;
type SetZoomStepAction = ReturnType<typeof setZoomStepAction>;
type SetPositionAction = ReturnType<typeof setPositionAction>;
type SetAdditionalCoordinatesAction = ReturnType<typeof setAdditionalCoordinatesAction>;
type SetRotationAction = ReturnType<typeof setRotationAction>;
type SetDirectionAction = ReturnType<typeof setDirectionAction>;
type MoveFlycamOrthoAction = ReturnType<typeof moveFlycamOrthoAction>;
type MovePlaneFlycamOrthoAction = ReturnType<typeof movePlaneFlycamOrthoAction>;
type MoveFlycamAction = ReturnType<typeof moveFlycamAction>;
type YawFlycamAction = ReturnType<typeof yawFlycamAction>;
type RollFlycamAction = ReturnType<typeof rollFlycamAction>;
type PitchFlycamAction = ReturnType<typeof pitchFlycamAction>;
type RotateFlycamAction = ReturnType<typeof rotateFlycamAction>;

export type FlycamAction =
  | ZoomInAction
  | ZoomOutAction
  | ZoomByDeltaAction
  | SetZoomStepAction
  | SetPositionAction
  | SetAdditionalCoordinatesAction
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
  "SET_ADDITIONAL_COORDINATES",
];
export const zoomInAction = () =>
  ({
    type: "ZOOM_IN",
  }) as const;

export const zoomOutAction = () =>
  ({
    type: "ZOOM_OUT",
  }) as const;

export const zoomByDeltaAction = (zoomDelta: number) =>
  ({
    type: "ZOOM_BY_DELTA",
    zoomDelta,
  }) as const;

export const setZoomStepAction = (zoomStep: number) =>
  ({
    type: "SET_ZOOM_STEP",
    zoomStep,
  }) as const;

export const setPositionAction = (position: Vector3, dimensionToSkip?: number | null | undefined) =>
  ({
    type: "SET_POSITION",
    position,
    dimensionToSkip,
  }) as const;

export const setAdditionalCoordinatesAction = (values: AdditionalCoordinate[] | null | undefined) =>
  ({
    type: "SET_ADDITIONAL_COORDINATES",
    values,
  }) as const;

export const setRotationAction = (rotation: Vector3) =>
  ({
    type: "SET_ROTATION",
    rotation,
  }) as const;

export const setDirectionAction = (direction: Vector3) =>
  ({
    type: "SET_DIRECTION",
    direction,
  }) as const;

export const moveFlycamOrthoAction = (vector: Vector3, planeId: OrthoView | null | undefined) =>
  ({
    type: "MOVE_FLYCAM_ORTHO",
    vector,
    planeId,
  }) as const;

export const movePlaneFlycamOrthoAction = (
  vector: Vector3,
  planeId: OrthoView,
  increaseSpeedWithZoom: boolean = true,
) =>
  ({
    type: "MOVE_PLANE_FLYCAM_ORTHO",
    vector,
    planeId,
    increaseSpeedWithZoom,
  }) as const;

export const moveFlycamAction = (vector: Vector3) =>
  ({
    type: "MOVE_FLYCAM",
    vector,
  }) as const;

export const yawFlycamAction = (angle: number, regardDistance: boolean = false) =>
  ({
    type: "YAW_FLYCAM",
    angle,
    regardDistance,
  }) as const;

export const rollFlycamAction = (angle: number, regardDistance: boolean = false) =>
  ({
    type: "ROLL_FLYCAM",
    angle,
    regardDistance,
  }) as const;

export const pitchFlycamAction = (angle: number, regardDistance: boolean = false) =>
  ({
    type: "PITCH_FLYCAM",
    angle,
    regardDistance,
  }) as const;

export const rotateFlycamAction = (angle: number, axis: Vector3, regardDistance: boolean = false) =>
  ({
    type: "ROTATE_FLYCAM",
    angle,
    axis,
    regardDistance,
  }) as const;
