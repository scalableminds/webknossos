/**
 * volumetracing_actions.js
 * @flow
 */
import type { ServerVolumeTracing } from "types/api_flow_types";
import type { Vector2, Vector3, Vector4, OrthoView, ContourMode } from "oxalis/constants";
import type { BucketDataArray } from "oxalis/model/bucket_data_handling/bucket";

type InitializeVolumeTracingAction = {
  type: "INITIALIZE_VOLUMETRACING",
  tracing: ServerVolumeTracing,
};
type CreateCellAction = { type: "CREATE_CELL" };
type StartEditingAction = { type: "START_EDITING", position: Vector3, planeId: OrthoView };
type AddToLayerAction = { type: "ADD_TO_LAYER", position: Vector3 };
type FloodFillAction = {
  type: "FLOOD_FILL",
  position: Vector3,
  planeId: OrthoView,
  callback?: () => void,
};
type FinishEditingAction = { type: "FINISH_EDITING" };
type SetActiveCellAction = { type: "SET_ACTIVE_CELL", cellId: number };

export type CopySegmentationLayerAction = {
  type: "COPY_SEGMENTATION_LAYER",
  source: "previousLayer" | "nextLayer",
};
export type MaybeBucketLoadedPromise = null | Promise<BucketDataArray>;
export type AddBucketToUndoAction = {
  type: "ADD_BUCKET_TO_UNDO",
  zoomedBucketAddress: Vector4,
  bucketData: BucketDataArray,
  maybeBucketLoadedPromise: MaybeBucketLoadedPromise,
};
type UpdateDirectionAction = { type: "UPDATE_DIRECTION", centroid: Vector3 };
type ResetContourAction = { type: "RESET_CONTOUR" };
export type FinishAnnotationStrokeAction = { type: "FINISH_ANNOTATION_STROKE" };
type SetMousePositionAction = { type: "SET_MOUSE_POSITION", position: Vector2 };
type HideBrushAction = { type: "HIDE_BRUSH" };
type SetContourTracingModeAction = { type: "SET_CONTOUR_TRACING_MODE", mode: ContourMode };
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
  | UpdateDirectionAction
  | ResetContourAction
  | FinishAnnotationStrokeAction
  | SetMousePositionAction
  | HideBrushAction
  | CopySegmentationLayerAction
  | InferSegmentationInViewportAction
  | SetContourTracingModeAction
  | AddBucketToUndoAction
  | ImportVolumeTracingAction
  | SetMaxCellAction;

export const VolumeTracingSaveRelevantActions = [
  "CREATE_CELL",
  "SET_ACTIVE_CELL",
  "SET_USER_BOUNDING_BOXES",
  "ADD_USER_BOUNDING_BOXES",
  "FINISH_ANNOTATION_STROKE",
];

export const VolumeTracingUndoRelevantActions = ["START_EDITING", "COPY_SEGMENTATION_LAYER"];

export const initializeVolumeTracingAction = (
  tracing: ServerVolumeTracing,
): InitializeVolumeTracingAction => ({
  type: "INITIALIZE_VOLUMETRACING",
  tracing,
});

export const createCellAction = (): CreateCellAction => ({
  type: "CREATE_CELL",
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

export const floodFillAction = (
  position: Vector3,
  planeId: OrthoView,
  callback?: () => void,
): FloodFillAction => ({
  type: "FLOOD_FILL",
  position,
  planeId,
  callback,
});

export const finishEditingAction = (): FinishEditingAction => ({
  type: "FINISH_EDITING",
});

export const setActiveCellAction = (cellId: number): SetActiveCellAction => ({
  type: "SET_ACTIVE_CELL",
  cellId,
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

export const addBucketToUndoAction = (
  zoomedBucketAddress: Vector4,
  bucketData: BucketDataArray,
  maybeBucketLoadedPromise: MaybeBucketLoadedPromise,
): AddBucketToUndoAction => ({
  type: "ADD_BUCKET_TO_UNDO",
  zoomedBucketAddress,
  bucketData,
  maybeBucketLoadedPromise,
});

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
