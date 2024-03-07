import type { ServerEditableMapping, ServerVolumeTracing } from "types/api_flow_types";
import type { Vector2, Vector3, OrthoView, ContourMode, BucketAddress } from "oxalis/constants";
import type { BucketDataArray } from "oxalis/model/bucket_data_handling/bucket";
import type { Segment, SegmentGroup, SegmentMap } from "oxalis/store";
import Deferred from "libs/async/deferred";
import type { Dispatch } from "redux";
import { AllUserBoundingBoxActions } from "oxalis/model/actions/annotation_actions";
import { QuickSelectGeometry } from "oxalis/geometries/helper_geometries";
import { batchActions } from "redux-batched-actions";
import { type AdditionalCoordinate } from "types/api_flow_types";

export type InitializeVolumeTracingAction = ReturnType<typeof initializeVolumeTracingAction>;
export type InitializeEditableMappingAction = ReturnType<typeof initializeEditableMappingAction>;
export type CreateCellAction = ReturnType<typeof createCellAction>;
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
export type SetSelectedSegmentsOrGroupAction = ReturnType<typeof setSelectedSegmentsOrGroupAction>;
export type SetSegmentsAction = ReturnType<typeof setSegmentsAction>;
export type UpdateSegmentAction = ReturnType<typeof updateSegmentAction>;
export type RemoveSegmentAction = ReturnType<typeof removeSegmentAction>;
export type DeleteSegmentDataAction = ReturnType<typeof deleteSegmentDataAction>;
export type SetSegmentGroupsAction = ReturnType<typeof setSegmentGroupsAction>;
export type SetMappingIsEditableAction = ReturnType<typeof setMappingIsEditableAction>;

export type ComputeQuickSelectForRectAction = ReturnType<typeof computeQuickSelectForRectAction>;
export type MaybePrefetchEmbeddingAction = ReturnType<typeof maybePrefetchEmbeddingAction>;
export type FineTuneQuickSelectAction = ReturnType<typeof fineTuneQuickSelectAction>;
export type CancelQuickSelectAction = ReturnType<typeof cancelQuickSelectAction>;
export type ConfirmQuickSelectAction = ReturnType<typeof confirmQuickSelectAction>;

export type BatchableUpdateSegmentAction =
  | UpdateSegmentAction
  | RemoveSegmentAction
  | SetSegmentGroupsAction;
export type BatchUpdateGroupsAndSegmentsAction = {
  type: "BATCH_UPDATE_GROUPS_AND_SEGMENTS";
  payload: BatchableUpdateSegmentAction[];
  meta: {
    batch: true;
  };
};

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
  | RemoveSegmentAction
  | DeleteSegmentDataAction
  | SetSegmentGroupsAction
  | AddBucketToUndoAction
  | ImportVolumeTracingAction
  | SetLargestSegmentIdAction
  | SetSelectedSegmentsOrGroupAction
  | SetMappingIsEditableAction
  | InitializeEditableMappingAction
  | ComputeQuickSelectForRectAction
  | MaybePrefetchEmbeddingAction
  | FineTuneQuickSelectAction
  | CancelQuickSelectAction
  | ConfirmQuickSelectAction
  | BatchUpdateGroupsAndSegmentsAction;

export const VolumeTracingSaveRelevantActions = [
  "CREATE_CELL",
  "SET_ACTIVE_CELL",
  "FINISH_ANNOTATION_STROKE",
  "UPDATE_SEGMENT",
  "SET_SEGMENT_GROUPS",
  "REMOVE_SEGMENT",
  "SET_SEGMENTS",
  ...AllUserBoundingBoxActions,
  // Note that the following two actions are defined in settings_actions.ts
  "SET_MAPPING",
  "SET_MAPPING_ENABLED",
  "BATCH_UPDATE_GROUPS_AND_SEGMENTS",
];

export const VolumeTracingUndoRelevantActions = ["START_EDITING", "COPY_SEGMENTATION_LAYER"];

export const initializeVolumeTracingAction = (tracing: ServerVolumeTracing) =>
  ({
    type: "INITIALIZE_VOLUMETRACING",
    tracing,
  }) as const;

export const initializeEditableMappingAction = (mapping: ServerEditableMapping) =>
  ({
    type: "INITIALIZE_EDITABLE_MAPPING",
    mapping,
  }) as const;

/*
 * The largestSegmentId parameter is required to enforce that the dispatcher of the action
 * has dealt with the case where the maximum segment id is not set. In that case,
 * the create cell action should not be exposed via the UI.
 */
export const createCellAction = (activeCellId: number, largestSegmentId: number) => {
  // The largestSegmentId is only updated if a voxel using that id was annotated. Therefore, it can happen
  // that the activeCellId is larger than the largestSegmentId. Choose the larger of the two ids increased by one.
  const newSegmentId =
    largestSegmentId && largestSegmentId > activeCellId ? largestSegmentId + 1 : activeCellId + 1;
  return {
    type: "CREATE_CELL",
    newSegmentId,
  } as const;
};

export const startEditingAction = (position: Vector3, planeId: OrthoView) =>
  ({
    type: "START_EDITING",
    position,
    planeId,
  }) as const;

export const addToLayerAction = (position: Vector3) =>
  ({
    type: "ADD_TO_LAYER",
    position,
  }) as const;

export const floodFillAction = (position: Vector3, planeId: OrthoView, callback?: () => void) =>
  ({
    type: "FLOOD_FILL",
    position,
    planeId,
    callback,
  }) as const;

export const performMinCutAction = (treeId: number, boundingBoxId?: number) =>
  ({
    type: "PERFORM_MIN_CUT",
    treeId,
    boundingBoxId,
  }) as const;

export const finishEditingAction = () =>
  ({
    type: "FINISH_EDITING",
  }) as const;

export const setActiveCellAction = (
  segmentId: number,
  somePosition?: Vector3,
  someAdditionalCoordinates?: AdditionalCoordinate[] | null,
) =>
  ({
    type: "SET_ACTIVE_CELL",
    segmentId,
    somePosition,
    someAdditionalCoordinates,
  }) as const;

export const clickSegmentAction = (
  segmentId: number,
  somePosition: Vector3,
  someAdditionalCoordinates: AdditionalCoordinate[] | undefined | null,
  layerName?: string,
) =>
  ({
    type: "CLICK_SEGMENT",
    segmentId,
    somePosition,
    someAdditionalCoordinates,
    layerName,
  }) as const;

export const setSelectedSegmentsOrGroupAction = (
  selectedSegments: number[],
  selectedGroup: number | null,
  layerName: string,
) =>
  ({
    type: "SET_SELECTED_SEGMENTS_OR_GROUP",
    selectedSegments,
    selectedGroup,
    layerName,
  }) as const;

export const setSegmentsAction = (segments: SegmentMap, layerName: string) =>
  ({
    type: "SET_SEGMENTS",
    segments,
    layerName,
  }) as const;

export const updateSegmentAction = (
  segmentId: number,
  segment: Partial<Segment>,
  layerName: string,
  timestamp: number = Date.now(),
  createsNewUndoState: boolean = false,
) =>
  ({
    type: "UPDATE_SEGMENT",
    segmentId,
    segment,
    layerName,
    timestamp,
    createsNewUndoState,
  }) as const;

export const removeSegmentAction = (
  segmentId: number,
  layerName: string,
  timestamp: number = Date.now(),
) =>
  ({
    type: "REMOVE_SEGMENT",
    segmentId,
    layerName,
    timestamp,
  }) as const;

export const deleteSegmentDataAction = (
  segmentId: number,
  layerName: string,
  callback?: () => void,
  timestamp: number = Date.now(),
) =>
  ({
    type: "DELETE_SEGMENT_DATA",
    segmentId,
    layerName,
    callback,
    timestamp,
  }) as const;

export const setSegmentGroupsAction = (
  segmentGroups: Array<SegmentGroup>,
  layerName: string,
  calledFromUndoSaga: boolean = false,
) =>
  ({
    type: "SET_SEGMENT_GROUPS",
    segmentGroups,
    layerName,
    calledFromUndoSaga,
  }) as const;

export const interpolateSegmentationLayerAction = () =>
  ({
    type: "INTERPOLATE_SEGMENTATION_LAYER",
  }) as const;

export const registerLabelPointAction = (centroid: Vector3) =>
  ({
    type: "UPDATE_DIRECTION",
    centroid,
  }) as const;

export const resetContourAction = () =>
  ({
    type: "RESET_CONTOUR",
  }) as const;

export const finishAnnotationStrokeAction = (tracingId: string) =>
  ({
    type: "FINISH_ANNOTATION_STROKE",
    tracingId,
  }) as const;

export const setMousePositionAction = (position: Vector2 | null | undefined) =>
  ({
    type: "SET_MOUSE_POSITION",
    position,
  }) as const;

export const hideBrushAction = () =>
  ({
    type: "HIDE_BRUSH",
  }) as const;

export const setContourTracingModeAction = (mode: ContourMode) =>
  ({
    type: "SET_CONTOUR_TRACING_MODE",
    mode,
  }) as const;

export const addBucketToUndoAction = (
  zoomedBucketAddress: BucketAddress,
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
  }) as const;

export const importVolumeTracingAction = () =>
  ({
    type: "IMPORT_VOLUMETRACING",
  }) as const;

export const setLargestSegmentIdAction = (segmentId: number) =>
  ({
    type: "SET_LARGEST_SEGMENT_ID",
    segmentId,
  }) as const;

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
  }) as const;

export const computeQuickSelectForRectAction = (
  startPosition: Vector3,
  endPosition: Vector3,
  quickSelectGeometry: QuickSelectGeometry,
) =>
  ({
    type: "COMPUTE_QUICK_SELECT_FOR_RECT",
    startPosition,
    endPosition,
    quickSelectGeometry,
  }) as const;

export const maybePrefetchEmbeddingAction = (startPosition: Vector3) =>
  ({
    type: "MAYBE_PREFETCH_EMBEDDING",
    startPosition,
  }) as const;

export const fineTuneQuickSelectAction = (
  segmentMode: "dark" | "light",
  threshold: number,
  closeValue: number,
  erodeValue: number,
  dilateValue: number,
) =>
  ({
    type: "FINE_TUNE_QUICK_SELECT",
    segmentMode,
    threshold,
    closeValue,
    erodeValue,
    dilateValue,
  }) as const;

/*
 * Note that all actions must refer to the same volume layer.
 */
export const batchUpdateGroupsAndSegmentsAction = (actions: BatchableUpdateSegmentAction[]) =>
  batchActions(
    actions,
    "BATCH_UPDATE_GROUPS_AND_SEGMENTS",
  ) as unknown as BatchUpdateGroupsAndSegmentsAction;

export const cancelQuickSelectAction = () => ({ type: "CANCEL_QUICK_SELECT" }) as const;

export const confirmQuickSelectAction = () => ({ type: "CONFIRM_QUICK_SELECT" }) as const;
