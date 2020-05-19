/**
 * volumetracing_actions.js
 * @flow
 */
import type { ServerVolumeTracing } from "admin/api_flow_types";
import type { Vector2, Vector3, OrthoView, VolumeTool, ContourMode } from "oxalis/constants";

type InitializeVolumeTracingAction = {
  type: "INITIALIZE_VOLUMETRACING",
  tracing: ServerVolumeTracing,
};
type CreateCellAction = { type: "CREATE_CELL", cellId: ?number };
type StartEditingAction = { type: "START_EDITING", position: Vector3, planeId: OrthoView };
type AddToLayerAction = { type: "ADD_TO_LAYER", position: Vector3 };
type FinishEditingAction = { type: "FINISH_EDITING" };
type SetActiveCellAction = { type: "SET_ACTIVE_CELL", cellId: number };
type SetToolAction = { type: "SET_TOOL", tool: VolumeTool };
type CycleToolAction = { type: "CYCLE_TOOL" };
export type CopySegmentationLayerAction = {
  type: "COPY_SEGMENTATION_LAYER",
  source: "previousLayer" | "nextLayer",
};
type UpdateDirectionAction = { type: "UPDATE_DIRECTION", centroid: Vector3 };
type ResetContourAction = { type: "RESET_CONTOUR" };
type SetMousePositionAction = { type: "SET_MOUSE_POSITION", position: Vector2 };
type HideBrushAction = { type: "HIDE_BRUSH" };
type SetContourTracingMode = { type: "SET_CONTOUR_TRACING_MODE", mode: ContourMode };
export type InferSegmentationInViewportAction = {
  type: "INFER_SEGMENT_IN_VIEWPORT",
  position: Vector3,
};

export type VolumeTracingAction =
  | InitializeVolumeTracingAction
  | CreateCellAction
  | StartEditingAction
  | AddToLayerAction
  | FinishEditingAction
  | SetActiveCellAction
  | SetToolAction
  | CycleToolAction
  | UpdateDirectionAction
  | ResetContourAction
  | SetMousePositionAction
  | HideBrushAction
  | CopySegmentationLayerAction
  | InferSegmentationInViewportAction
  | SetContourTracingMode;

export const VolumeTracingSaveRelevantActions = [
  "CREATE_CELL",
  "SET_ACTIVE_CELL",
  "SET_USER_BOUNDING_BOXES",
  "ADD_USER_BOUNDING_BOXES",
];

export const initializeVolumeTracingAction = (
  tracing: ServerVolumeTracing,
): InitializeVolumeTracingAction => ({
  type: "INITIALIZE_VOLUMETRACING",
  tracing,
});

export const createCellAction = (cellId: ?number): CreateCellAction => ({
  type: "CREATE_CELL",
  cellId,
});

export const startEditingAction = (position: Vector3, planeId: OrthoView): StartEditingAction => ({
  type: "START_EDITING",
  position,
  planeId,
});

export const addToLayerAction = (position: Vector3): AddToLayerAction => ({
  type: "ADD_TO_LAYER",
  position,
});

export const finishEditingAction = (): FinishEditingAction => ({
  type: "FINISH_EDITING",
});

export const setActiveCellAction = (cellId: number): SetActiveCellAction => ({
  type: "SET_ACTIVE_CELL",
  cellId,
});

export const setToolAction = (tool: VolumeTool): SetToolAction => ({
  type: "SET_TOOL",
  tool,
});

export const cycleToolAction = (): CycleToolAction => ({
  type: "CYCLE_TOOL",
});

export const copySegmentationLayerAction = (fromNext?: boolean): CopySegmentationLayerAction => ({
  type: "COPY_SEGMENTATION_LAYER",
  source: fromNext ? "nextLayer" : "previousLayer",
});

export const updateDirectionAction = (centroid: Vector3): UpdateDirectionAction => ({
  type: "UPDATE_DIRECTION",
  centroid,
});

export const resetContourAction = (): ResetContourAction => ({
  type: "RESET_CONTOUR",
});

export const setMousePositionAction = (position: Vector2): SetMousePositionAction => ({
  type: "SET_MOUSE_POSITION",
  position,
});

export const hideBrushAction = (): HideBrushAction => ({
  type: "HIDE_BRUSH",
});

export const setContourTracingMode = (mode: ContourMode): SetContourTracingMode => ({
  type: "SET_CONTOUR_TRACING_MODE",
  mode,
});

export const inferSegmentationInViewportAction = (
  position: Vector3,
): InferSegmentationInViewportAction => ({
  type: "INFER_SEGMENT_IN_VIEWPORT",
  position,
});
