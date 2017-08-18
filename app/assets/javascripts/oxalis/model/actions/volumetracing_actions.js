/**
 * volumetracing_actions.js
 * @flow
 */
import type { Vector3, OrthoViewType, VolumeTraceOrMoveModeType } from "oxalis/constants";
import type { ServerVolumeTracingType } from "oxalis/model";
import type { APIAnnotationType } from "admin/api_flow_types";

type InitializeVolumeTracingActionType = {
  type: "INITIALIZE_VOLUMETRACING",
  annotation: APIAnnotationType,
  tracing: ServerVolumeTracingType,
};
type CreateCellActionType = { type: "CREATE_CELL", cellId: ?number };
type StartEditingActionType = { type: "START_EDITING", planeId: OrthoViewType };
type AddToLayerActionType = { type: "ADD_TO_LAYER", position: Vector3 };
type FinishEditingActionType = { type: "FINISH_EDITING" };
type SetActiveCellActionType = { type: "SET_ACTIVE_CELL", cellId: number };
type SetModeActionType = { type: "SET_MODE", mode: VolumeTraceOrMoveModeType };
type ToggleModeActionType = { type: "TOGGLE_MODE" };
type UpdateDirectionActionType = { type: "UPDATE_DIRECTION", centroid: Vector3 };
type ResetContourActionType = { type: "RESET_CONTOUR" };

export type VolumeTracingActionType =
  | InitializeVolumeTracingActionType
  | CreateCellActionType
  | StartEditingActionType
  | AddToLayerActionType
  | FinishEditingActionType
  | SetActiveCellActionType
  | SetModeActionType
  | ToggleModeActionType
  | UpdateDirectionActionType
  | ResetContourActionType;

export const VolumeTracingSaveRelevantActions = ["CREATE_CELL", "SET_ACTIVE_CELL"];

export const initializeVolumeTracingAction = (
  annotation: APIAnnotationType,
  tracing: ServerVolumeTracingType,
): InitializeVolumeTracingActionType => ({
  type: "INITIALIZE_VOLUMETRACING",
  annotation,
  tracing,
});

export const createCellAction = (cellId: ?number): CreateCellActionType => ({
  type: "CREATE_CELL",
  cellId,
});

export const startEditingAction = (planeId: OrthoViewType): StartEditingActionType => ({
  type: "START_EDITING",
  planeId,
});

export const addToLayerAction = (position: Vector3): AddToLayerActionType => ({
  type: "ADD_TO_LAYER",
  position,
});

export const finishEditingAction = (): FinishEditingActionType => ({
  type: "FINISH_EDITING",
});

export const setActiveCellAction = (cellId: number): SetActiveCellActionType => ({
  type: "SET_ACTIVE_CELL",
  cellId,
});

export const setModeAction = (mode: VolumeTraceOrMoveModeType): SetModeActionType => ({
  type: "SET_MODE",
  mode,
});

export const toggleModeAction = (): ToggleModeActionType => ({
  type: "TOGGLE_MODE",
});

export const updateDirectionAction = (centroid: Vector3): UpdateDirectionActionType => ({
  type: "UPDATE_DIRECTION",
  centroid,
});

export const resetContourAction = (): ResetContourActionType => ({
  type: "RESET_CONTOUR",
});
