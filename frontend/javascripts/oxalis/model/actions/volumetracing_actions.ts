import type { ServerEditableMapping, ServerVolumeTracing } from "types/api_flow_types";
import type { Vector2, Vector3, Vector4, OrthoView, ContourMode } from "oxalis/constants";
import type { BucketDataArray } from "oxalis/model/bucket_data_handling/bucket";
import type { Segment, SegmentMap } from "oxalis/store";
import Deferred from "libs/deferred";
import type { Dispatch } from "redux";
import { AllUserBoundingBoxActions } from "oxalis/model/actions/annotation_actions";
import { RectangleGeometry } from "oxalis/geometries/contourgeometry";
export type InitializeVolumeTracingAction = ReturnType<typeof initializeVolumeTracingAction>;
export type InitializeEditableMappingAction = ReturnType<typeof initializeEditableMappingAction>;
type CreateCellAction = ReturnType<typeof createCellAction>;
type StartEditingAction = ReturnType<typeof startEditingAction>;
type AddToLayerAction = ReturnType<typeof addToLayerAction>;
type FloodFillAction = ReturnType<typeof floodFillAction>;
export type PerformMinCutAction = ReturnType<typeof performMinCutAction>;
type FinishEditingAction = ReturnType<typeof finishEditingAction>;
export type SetActiveCellAction = ReturnType<typeof setActiveCellAction>;
// A simple "click segment" is dispatched when clicking
// with the MOVE tool. Currently, this has the side-effect
// of adding the clicked segment to the segment list (if one
// exists and if it's not already there)
export type ClickSegmentAction = ReturnType<typeof clickSegmentAction>;
export type InterpolateSegmentationLayerAction = ReturnType<
  typeof interpolateSegmentationLayerAction
>;
export type MaybeUnmergedBucketLoadedPromise = null | Promise<BucketDataArray>;
export type AddBucketToUndoAction = ReturnType<typeof addBucketToUndoAction>;
type RegisterLabelPointAction = ReturnType<typeof registerLabelPointAction>;
type ResetContourAction = ReturnType<typeof resetContourAction>;
export type FinishAnnotationStrokeAction = ReturnType<typeof finishAnnotationStrokeAction>;
type SetMousePositionAction = ReturnType<typeof setMousePositionAction>;
type HideBrushAction = ReturnType<typeof hideBrushAction>;
type SetContourTracingModeAction = ReturnType<typeof setContourTracingModeAction>;
export type ImportVolumeTracingAction = ReturnType<typeof importVolumeTracingAction>;
export type SetLargestSegmentIdAction = ReturnType<typeof setLargestSegmentIdAction>;
export type SetSegmentsAction = ReturnType<typeof setSegmentsAction>;
export type UpdateSegmentAction = ReturnType<typeof updateSegmentAction>;
export type SetMappingIsEditableAction = ReturnType<typeof setMappingIsEditableAction>;

export type ComputeWatershedForRectAction = ReturnType<typeof computeWatershedForRectAction>;
export type FineTuneWatershedAction = ReturnType<typeof fineTuneWatershedAction>;
export type CancelWatershedAction = ReturnType<typeof cancelWatershedAction>;
export type ConfirmWatershedAction = ReturnType<typeof confirmWatershedAction>;

export type VolumeTracingAction =
  | InitializeVolumeTracingAction
  | CreateCellAction
  | StartEditingAction
  | AddToLayerAction
  | FloodFillAction
  | PerformMinCutAction
  | FinishEditingAction
  | SetActiveCellAction
  | ClickSegmentAction
  | RegisterLabelPointAction
  | ResetContourAction
  | FinishAnnotationStrokeAction
  | SetMousePositionAction
  | HideBrushAction
  | InterpolateSegmentationLayerAction
  | SetContourTracingModeAction
  | SetSegmentsAction
  | UpdateSegmentAction
  | AddBucketToUndoAction
  | ImportVolumeTracingAction
  | SetLargestSegmentIdAction
  | SetMappingIsEditableAction
  | InitializeEditableMappingAction
  | ComputeWatershedForRectAction
  | FineTuneWatershedAction
  | CancelWatershedAction
  | ConfirmWatershedAction;

export const VolumeTracingSaveRelevantActions = [
  "CREATE_CELL",
  "SET_ACTIVE_CELL",
  "FINISH_ANNOTATION_STROKE",
  "UPDATE_SEGMENT",
  "SET_SEGMENTS",
  ...AllUserBoundingBoxActions,
  // Note that the following two actions are defined in settings_actions.ts
  "SET_MAPPING",
  "SET_MAPPING_ENABLED",
];

export const VolumeTracingUndoRelevantActions = ["START_EDITING", "COPY_SEGMENTATION_LAYER"];

export const initializeVolumeTracingAction = (tracing: ServerVolumeTracing) =>
  ({
    type: "INITIALIZE_VOLUMETRACING",
    tracing,
  } as const);

export const initializeEditableMappingAction = (mapping: ServerEditableMapping) =>
  ({
    type: "INITIALIZE_EDITABLE_MAPPING",
    mapping,
  } as const);

/*
 * The largestSegmentId parameter is required to enforce that the dispatcher of the action
 * has dealt with the case where the maximum segment id is not set. In that case,
 * the create cell action should not be exposed via the UI.
 */
export const createCellAction = (largestSegmentId: number) =>
  ({
    type: "CREATE_CELL",
    largestSegmentId,
  } as const);

export const startEditingAction = (position: Vector3, planeId: OrthoView) =>
  ({
    type: "START_EDITING",
    position,
    planeId,
  } as const);

export const addToLayerAction = (position: Vector3) =>
  ({
    type: "ADD_TO_LAYER",
    position,
  } as const);

export const floodFillAction = (position: Vector3, planeId: OrthoView, callback?: () => void) =>
  ({
    type: "FLOOD_FILL",
    position,
    planeId,
    callback,
  } as const);

export const performMinCutAction = (treeId: number, boundingBoxId?: number) =>
  ({
    type: "PERFORM_MIN_CUT",
    treeId,
    boundingBoxId,
  } as const);

export const finishEditingAction = () =>
  ({
    type: "FINISH_EDITING",
  } as const);

export const setActiveCellAction = (cellId: number, somePosition?: Vector3) =>
  ({
    type: "SET_ACTIVE_CELL",
    cellId,
    somePosition,
  } as const);

export const clickSegmentAction = (cellId: number, somePosition: Vector3) =>
  ({
    type: "CLICK_SEGMENT",
    cellId,
    somePosition,
  } as const);

export const setSegmentsAction = (segments: SegmentMap, layerName: string) =>
  ({
    type: "SET_SEGMENTS",
    segments,
    layerName,
  } as const);

export const updateSegmentAction = (
  segmentId: number,
  segment: Partial<Segment>,
  layerName: string,
  timestamp: number = Date.now(),
) =>
  ({
    type: "UPDATE_SEGMENT",
    segmentId,
    segment,
    layerName,
    timestamp,
  } as const);

export const interpolateSegmentationLayerAction = () =>
  ({
    type: "INTERPOLATE_SEGMENTATION_LAYER",
  } as const);

export const registerLabelPointAction = (centroid: Vector3) =>
  ({
    type: "UPDATE_DIRECTION",
    centroid,
  } as const);

export const resetContourAction = () =>
  ({
    type: "RESET_CONTOUR",
  } as const);

export const finishAnnotationStrokeAction = (tracingId: string) =>
  ({
    type: "FINISH_ANNOTATION_STROKE",
    tracingId,
  } as const);

export const setMousePositionAction = (position: Vector2 | null | undefined) =>
  ({
    type: "SET_MOUSE_POSITION",
    position,
  } as const);

export const hideBrushAction = () =>
  ({
    type: "HIDE_BRUSH",
  } as const);

export const setContourTracingModeAction = (mode: ContourMode) =>
  ({
    type: "SET_CONTOUR_TRACING_MODE",
    mode,
  } as const);

export const addBucketToUndoAction = (
  zoomedBucketAddress: Vector4,
  bucketData: BucketDataArray,
  maybeUnmergedBucketLoadedPromise: MaybeUnmergedBucketLoadedPromise,
  pendingOperations: Array<(arg0: BucketDataArray) => void>,
  tracingId: string,
) =>
  ({
    type: "ADD_BUCKET_TO_UNDO",
    zoomedBucketAddress,
    bucketData,
    maybeUnmergedBucketLoadedPromise,
    pendingOperations: pendingOperations.slice(),
    tracingId,
  } as const);

export const importVolumeTracingAction = () =>
  ({
    type: "IMPORT_VOLUMETRACING",
  } as const);

export const setLargestSegmentIdAction = (cellId: number) =>
  ({
    type: "SET_LARGEST_SEGMENT_ID",
    cellId,
  } as const);

export const dispatchFloodfillAsync = async (
  dispatch: Dispatch<any>,
  position: Vector3,
  planeId: OrthoView,
): Promise<void> => {
  const readyDeferred = new Deferred();
  const action = floodFillAction(position, planeId, () => readyDeferred.resolve(null));
  dispatch(action);
  await readyDeferred.promise();
};

export const setMappingIsEditableAction = () =>
  ({
    type: "SET_MAPPING_IS_EDITABLE",
  } as const);

export const computeWatershedForRectAction = (
  startPosition: Vector3,
  endPosition: Vector3,
  rectangleGeometry: RectangleGeometry,
) =>
  ({
    type: "COMPUTE_WATERSHED_FOR_RECT",
    startPosition,
    endPosition,
    rectangleGeometry,
  } as const);

export const fineTuneWatershedAction = (
  threshold: number,
  closeValue: number,
  erodeValue: number,
  dilateValue: number,
) => ({ type: "FINE_TUNE_WATERSHED", threshold, closeValue, erodeValue, dilateValue } as const);

export const cancelWatershedAction = () => ({ type: "CANCEL_WATERSHED" } as const);

export const confirmWatershedAction = () => ({ type: "CONFIRM_WATERSHED" } as const);
