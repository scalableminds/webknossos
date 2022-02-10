/**
 * volumetracing_actions.js
 * @flow
 */
import type { ServerVolumeTracing } from "types/api_flow_types";
import type { Vector2, Vector3, Vector4, OrthoView, ContourMode } from "oxalis/constants";
import type { BucketDataArray } from "oxalis/model/bucket_data_handling/bucket";
import type { Segment, SegmentMap } from "oxalis/store";
import Deferred from "libs/deferred";
import { type Dispatch } from "redux";
import { AllUserBoundingBoxActions } from "oxalis/model/actions/annotation_actions";

export type InitializeVolumeTracingAction = {
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
export type SetActiveCellAction = {
  type: "SET_ACTIVE_CELL",
  cellId: number,
  somePosition?: Vector3,
};

// A simple "click segment" is dispatched when clicking
// with the MOVE tool. Currently, this has the side-effect
// of adding the clicked segment to the segment list (if one
// exists and if it's not already there)
export type ClickSegmentAction = {
  type: "CLICK_SEGMENT",
  cellId: number,
  somePosition: Vector3,
};

export type CopySegmentationLayerAction = {
  type: "COPY_SEGMENTATION_LAYER",
  source: "previousLayer" | "nextLayer",
};
export type MaybeUnmergedBucketLoadedPromise = null | Promise<BucketDataArray>;
export type AddBucketToUndoAction = {
  type: "ADD_BUCKET_TO_UNDO",
  zoomedBucketAddress: Vector4,
  bucketData: BucketDataArray,
  maybeUnmergedBucketLoadedPromise: MaybeUnmergedBucketLoadedPromise,
  pendingOperations: Array<(BucketDataArray) => void>,
  tracingId: string,
};
type UpdateDirectionAction = { type: "UPDATE_DIRECTION", centroid: Vector3 };
type ResetContourAction = { type: "RESET_CONTOUR" };
export type FinishAnnotationStrokeAction = { type: "FINISH_ANNOTATION_STROKE", tracingId: string };
type SetMousePositionAction = { type: "SET_MOUSE_POSITION", position: ?Vector2 };
type HideBrushAction = { type: "HIDE_BRUSH" };
type SetContourTracingModeAction = { type: "SET_CONTOUR_TRACING_MODE", mode: ContourMode };
export type InferSegmentationInViewportAction = {
  type: "INFER_SEGMENT_IN_VIEWPORT",
  position: Vector3,
};
export type ImportVolumeTracingAction = { type: "IMPORT_VOLUMETRACING" };
export type SetMaxCellAction = { type: "SET_MAX_CELL", cellId: number };
export type SetSegmentsAction = {
  type: "SET_SEGMENTS",
  segments: SegmentMap,
  layerName: string,
};

export type UpdateSegmentAction = {
  type: "UPDATE_SEGMENT",
  segmentId: number,
  segment: $Shape<Segment>,
  layerName: string,
  timestamp: number,
};

export type VolumeTracingAction =
  | InitializeVolumeTracingAction
  | CreateCellAction
  | StartEditingAction
  | AddToLayerAction
  | FloodFillAction
  | FinishEditingAction
  | SetActiveCellAction
  | ClickSegmentAction
  | UpdateDirectionAction
  | ResetContourAction
  | FinishAnnotationStrokeAction
  | SetMousePositionAction
  | HideBrushAction
  | CopySegmentationLayerAction
  | InferSegmentationInViewportAction
  | SetContourTracingModeAction
  | SetSegmentsAction
  | UpdateSegmentAction
  | AddBucketToUndoAction
  | ImportVolumeTracingAction
  | SetMaxCellAction;

export const VolumeTracingSaveRelevantActions = [
  "CREATE_CELL",
  "SET_ACTIVE_CELL",
  "FINISH_ANNOTATION_STROKE",
  "UPDATE_SEGMENT",
  "SET_SEGMENTS",
  ...AllUserBoundingBoxActions,
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

export const setActiveCellAction = (
  cellId: number,
  somePosition?: Vector3,
): SetActiveCellAction => ({
  type: "SET_ACTIVE_CELL",
  cellId,
  somePosition,
});

export const clickSegmentAction = (cellId: number, somePosition: Vector3): ClickSegmentAction => ({
  type: "CLICK_SEGMENT",
  cellId,
  somePosition,
});

export const setSegmentsActions = (segments: SegmentMap, layerName: string): SetSegmentsAction => ({
  type: "SET_SEGMENTS",
  segments,
  layerName,
});

export const updateSegmentAction = (
  segmentId: number,
  segment: $Shape<Segment>,
  layerName: string,
  timestamp: number = Date.now(),
): UpdateSegmentAction => ({
  type: "UPDATE_SEGMENT",
  segmentId,
  segment,
  layerName,
  timestamp,
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

export const finishAnnotationStrokeAction = (tracingId: string): FinishAnnotationStrokeAction => ({
  type: "FINISH_ANNOTATION_STROKE",
  tracingId,
});

export const setMousePositionAction = (position: ?Vector2): SetMousePositionAction => ({
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
  maybeUnmergedBucketLoadedPromise: MaybeUnmergedBucketLoadedPromise,
  pendingOperations: Array<(BucketDataArray) => void>,
  tracingId: string,
): AddBucketToUndoAction => ({
  type: "ADD_BUCKET_TO_UNDO",
  zoomedBucketAddress,
  bucketData,
  maybeUnmergedBucketLoadedPromise,
  pendingOperations: pendingOperations.slice(),
  tracingId,
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

export const dispatchFloodfillAsync = async (
  dispatch: Dispatch<*>,
  position: Vector3,
  planeId: OrthoView,
): Promise<void> => {
  const readyDeferred = new Deferred();
  const action = floodFillAction(position, planeId, () => readyDeferred.resolve());
  dispatch(action);
  await readyDeferred.promise();
};
