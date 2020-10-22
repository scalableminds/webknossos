/**
 * volumetracing_actions.js
 * @flow
 */
import type { ServerVolumeTracing } from "admin/api_flow_types";
import type {
  Vector2,
  Vector3,
  Vector4,
  OrthoView,
  VolumeTool,
  ContourMode,
  OverwriteMode,
} from "oxalis/constants";
import type { BucketDataArray } from "oxalis/model/bucket_data_handling/bucket";

type InitializeVolumeTracingAction = {
  type: "INITIALIZE_VOLUMETRACING",
  tracing: ServerVolumeTracing,
};
type CreateCellAction = { type: "CREATE_CELL", cellId: ?number };
type StartEditingAction = { type: "START_EDITING", position: Vector3, planeId: OrthoView };
type AddToLayerAction = { type: "ADD_TO_LAYER", position: Vector3 };
type FloodFillAction = { type: "FLOOD_FILL", position: Vector3, planeId: OrthoView };
type FinishEditingAction = { type: "FINISH_EDITING" };
type SetActiveCellAction = { type: "SET_ACTIVE_CELL", cellId: number };
type SetToolAction = { type: "SET_TOOL", tool: VolumeTool };
type CycleToolAction = { type: "CYCLE_TOOL" };
export type CopySegmentationLayerAction = {
  type: "COPY_SEGMENTATION_LAYER",
  source: "previousLayer" | "nextLayer",
};
export type AddBucketToUndoAction = {
  type: "ADD_BUCKET_TO_UNDO",
  zoomedBucketAddress: Vector4,
  bucketData: BucketDataArray,
};
type UpdateDirectionAction = { type: "UPDATE_DIRECTION", centroid: Vector3 };
type ResetContourAction = { type: "RESET_CONTOUR" };
export type FinishAnnotationStrokeAction = { type: "FINISH_ANNOTATION_STROKE" };
type SetMousePositionAction = { type: "SET_MOUSE_POSITION", position: Vector2 };
type HideBrushAction = { type: "HIDE_BRUSH" };
type SetContourTracingModeAction = { type: "SET_CONTOUR_TRACING_MODE", mode: ContourMode };
type SetOverwriteModeAction = { type: "SET_OVERWRITE_MODE", mode: OverwriteMode };
export type InferSegmentationInViewportAction = {
  type: "INFER_SEGMENT_IN_VIEWPORT",
  position: Vector3,
};
export type ImportVolumeTracingAction = { type: "IMPORT_VOLUMETRACING" };
export type SetMaxCellAction = { type: "SET_MAX_CELL", cellId: number };

export type VolumeTracingAction =
  | InitializeVolumeTracingAction
  | CreateCellAction
  | StartEditingAction
  | AddToLayerAction
  | FloodFillAction
  | FinishEditingAction
  | SetActiveCellAction
  | SetToolAction
  | CycleToolAction
  | UpdateDirectionAction
  | ResetContourAction
  | FinishAnnotationStrokeAction
  | SetMousePositionAction
  | HideBrushAction
  | CopySegmentationLayerAction
  | InferSegmentationInViewportAction
  | SetContourTracingModeAction
  | SetOverwriteModeAction
  | AddBucketToUndoAction
  | ImportVolumeTracingAction
  | SetMaxCellAction;

export const VolumeTracingSaveRelevantActions = [
  "CREATE_CELL",
  "SET_ACTIVE_CELL",
  "SET_USER_BOUNDING_BOXES",
  "ADD_USER_BOUNDING_BOXES",
];

export const VolumeTracingUndoRelevantActions = ["START_EDITING", "COPY_SEGMENTATION_LAYER"];

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

export const floodFillAction = (position: Vector3, planeId: OrthoView): FloodFillAction => ({
  type: "FLOOD_FILL",
  position,
  planeId,
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

export const finishAnnotationStrokeAction = (): FinishAnnotationStrokeAction => ({
  type: "FINISH_ANNOTATION_STROKE",
});

export const setMousePositionAction = (position: Vector2): SetMousePositionAction => ({
  type: "SET_MOUSE_POSITION",
  position,
});

export const hideBrushAction = (): HideBrushAction => ({
  type: "HIDE_BRUSH",
});

export const setContourTracingModeAction = (mode: ContourMode): SetContourTracingModeAction => ({
  type: "SET_CONTOUR_TRACING_MODE",
  mode,
});

export const setOverwriteModeAction = (mode: OverwriteMode): SetOverwriteModeAction => ({
  type: "SET_OVERWRITE_MODE",
  mode,
});

export const addBucketToUndoAction = (
  zoomedBucketAddress: Vector4,
  bucketData: BucketDataArray,
): AddBucketToUndoAction => ({ type: "ADD_BUCKET_TO_UNDO", zoomedBucketAddress, bucketData });

export const inferSegmentationInViewportAction = (
  position: Vector3,
): InferSegmentationInViewportAction => ({
  type: "INFER_SEGMENT_IN_VIEWPORT",
  position,
});

export const importVolumeTracingAction = (): ImportVolumeTracingAction => ({
  type: "IMPORT_VOLUMETRACING",
});

export const setMaxCellAction = (cellId: number): SetMaxCellAction => ({
  type: "SET_MAX_CELL",
  cellId,
});
