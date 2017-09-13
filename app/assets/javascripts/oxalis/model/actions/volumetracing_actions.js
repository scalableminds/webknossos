/**
 * volumetracing_actions.js
 * @flow
 */
import type { Vector2, Vector3, OrthoViewType, VolumeToolType } from "oxalis/constants";
import type { ServerTracing, VolumeContentDataType } from "oxalis/model";

type InitializeVolumeTracingActionType = {
  type: "INITIALIZE_VOLUMETRACING",
  tracing: ServerTracing<VolumeContentDataType>,
};
type CreateCellActionType = { type: "CREATE_CELL", cellId: ?number };
type StartEditingActionType = { type: "START_EDITING", planeId: OrthoViewType };
type AddToLayerActionType = { type: "ADD_TO_LAYER", position: Vector3 };
type FinishEditingActionType = { type: "FINISH_EDITING" };
type SetActiveCellActionType = { type: "SET_ACTIVE_CELL", cellId: number };
type SetToolActionType = { type: "SET_TOOL", tool: VolumeToolType };
type ToggleToolActionType = { type: "TOGGLE_TOOL" };
type UpdateDirectionActionType = { type: "UPDATE_DIRECTION", centroid: Vector3 };
type ResetContourActionType = { type: "RESET_CONTOUR" };
type SetBrushPositionActionType = { type: "SET_BRUSH_POSITION", position: Vector2 };
type HideBrushActionType = { type: "HIDE_BRUSH" };
type SetBrushSizeActionType = { type: "SET_BRUSH_SIZE", brushSize: number };

export type VolumeTracingActionType =
  | InitializeVolumeTracingActionType
  | CreateCellActionType
  | StartEditingActionType
  | AddToLayerActionType
  | FinishEditingActionType
  | SetActiveCellActionType
  | SetToolActionType
  | ToggleToolActionType
  | UpdateDirectionActionType
  | ResetContourActionType
  | SetBrushPositionActionType
  | HideBrushActionType
  | SetBrushSizeActionType;

export const VolumeTracingSaveRelevantActions = ["CREATE_CELL", "SET_ACTIVE_CELL"];

export const initializeVolumeTracingAction = (
  tracing: ServerTracing<VolumeContentDataType>,
): InitializeVolumeTracingActionType => ({
  type: "INITIALIZE_VOLUMETRACING",
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

export const setToolAction = (tool: VolumeToolType): SetToolActionType => ({
  type: "SET_TOOL",
  tool,
});

export const toggleToolAction = (): ToggleToolActionType => ({
  type: "TOGGLE_TOOL",
});

export const updateDirectionAction = (centroid: Vector3): UpdateDirectionActionType => ({
  type: "UPDATE_DIRECTION",
  centroid,
});

export const resetContourAction = (): ResetContourActionType => ({
  type: "RESET_CONTOUR",
});

export const setBrushPositionAction = (position: Vector2): SetBrushPositionActionType => ({
  type: "SET_BRUSH_POSITION",
  position,
});

export const hideBrushAction = (): HideBrushActionType => ({
  type: "HIDE_BRUSH",
});

export const setBrushSizeAction = (brushSize: number): SetBrushSizeActionType => ({
  type: "SET_BRUSH_SIZE",
  brushSize,
});
