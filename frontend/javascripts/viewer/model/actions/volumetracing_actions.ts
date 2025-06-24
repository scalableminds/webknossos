import Deferred from "libs/async/deferred";
import type { Dispatch } from "redux";
import { batchActions } from "redux-batched-actions";
import type { BucketDataArray, ServerEditableMapping, ServerVolumeTracing } from "types/api_types";
import type { AdditionalCoordinate } from "types/api_types";
import type { ContourMode, OrthoView, Vector2, Vector3 } from "viewer/constants";
import type { QuickSelectGeometry } from "viewer/geometries/helper_geometries";
import { AllUserBoundingBoxActions } from "viewer/model/actions/annotation_actions";
import type { NumberLike, Segment, SegmentGroup, SegmentMap } from "viewer/store";
import type BucketSnapshot from "../bucket_data_handling/bucket_snapshot";
import type { ApplicableVolumeUpdateAction } from "../sagas/update_actions";

export type InitializeVolumeTracingAction = ReturnType<typeof initializeVolumeTracingAction>;
export type InitializeEditableMappingAction = ReturnType<typeof initializeEditableMappingAction>;
export type CreateCellAction = ReturnType<typeof createCellAction>;
type StartEditingAction = ReturnType<typeof startEditingAction>;
type AddToLayerAction = ReturnType<typeof addToLayerAction>;
export type FloodFillAction = ReturnType<typeof floodFillAction>;
export type PerformMinCutAction = ReturnType<typeof performMinCutAction>;
type FinishEditingAction = ReturnType<typeof finishEditingAction>;
export type SetActiveCellAction = ReturnType<typeof setActiveCellAction>;
export type SetHideUnregisteredSegmentsAction = ReturnType<
  typeof setHideUnregisteredSegmentsAction
>;
// A simple "click segment" is dispatched when clicking
// with the MOVE tool. Currently, this has the side-effect
// of adding the clicked segment to the segment list (if one
// exists and if it's not already there)
export type ClickSegmentAction = ReturnType<typeof clickSegmentAction>;
export type InterpolateSegmentationLayerAction = ReturnType<
  typeof interpolateSegmentationLayerAction
>;
export type MaybeUnmergedBucketLoadedPromise = Promise<BucketDataArray> | null;
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
export type SetExpandedSegmentGroupsAction = ReturnType<typeof setExpandedSegmentGroupsAction>;
export type ToggleSegmentGroupAction = ReturnType<typeof toggleSegmentGroupAction>;
export type ToggleAllSegmentsAction = ReturnType<typeof toggleAllSegmentsAction>;
export type SetHasEditableMappingAction = ReturnType<typeof setHasEditableMappingAction>;
export type SetMappingIsLockedAction = ReturnType<typeof setMappingIsLockedAction>;
export type SetVolumeBucketDataHasChangedAction = ReturnType<
  typeof setVolumeBucketDataHasChangedAction
>;
export type ApplyVolumeUpdateActionsFromServerAction = ReturnType<
  typeof applyVolumeUpdateActionsFromServerAction
>;

export type ComputeQuickSelectForRectAction = ReturnType<typeof computeQuickSelectForRectAction>;
export type ComputeQuickSelectForPointAction = ReturnType<typeof computeQuickSelectForPointAction>;
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
  | SetHideUnregisteredSegmentsAction
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
  | SetExpandedSegmentGroupsAction
  | ToggleSegmentGroupAction
  | ToggleAllSegmentsAction
  | AddBucketToUndoAction
  | ImportVolumeTracingAction
  | SetLargestSegmentIdAction
  | SetSelectedSegmentsOrGroupAction
  | SetHasEditableMappingAction
  | SetMappingIsLockedAction
  | InitializeEditableMappingAction
  | ComputeQuickSelectForRectAction
  | ComputeQuickSelectForPointAction
  | FineTuneQuickSelectAction
  | CancelQuickSelectAction
  | ConfirmQuickSelectAction
  | SetVolumeBucketDataHasChangedAction
  | BatchUpdateGroupsAndSegmentsAction
  | ApplyVolumeUpdateActionsFromServerAction;

export const VolumeTracingSaveRelevantActions = [
  "CREATE_CELL",
  "SET_ACTIVE_CELL",
  "FINISH_ANNOTATION_STROKE",
  "UPDATE_SEGMENT",
  "SET_SEGMENT_GROUPS",
  "SET_EXPANDED_SEGMENT_GROUPS",
  "REMOVE_SEGMENT",
  "SET_SEGMENTS",
  ...AllUserBoundingBoxActions,
  // Note that the following three actions are defined in settings_actions.ts
  "SET_MAPPING",
  "SET_MAPPING_ENABLED",
  "FINISH_MAPPING_INITIALIZATION_ACTION",
  "BATCH_UPDATE_GROUPS_AND_SEGMENTS",
  "SET_HAS_EDITABLE_MAPPING",
  "SET_MAPPING_IS_LOCKED",
  "TOGGLE_SEGMENT_GROUP",
  "TOGGLE_ALL_SEGMENTS",
  "SET_HIDE_UNREGISTERED_SEGMENTS",
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
  activeUnmappedSegmentId?: number | null,
) =>
  ({
    type: "SET_ACTIVE_CELL",
    segmentId,
    somePosition,
    someAdditionalCoordinates,
    activeUnmappedSegmentId,
  }) as const;

export const setHideUnregisteredSegmentsAction = (value: boolean, layerName?: string) =>
  ({
    type: "SET_HIDE_UNREGISTERED_SEGMENTS",
    value,
    layerName,
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
  segmentId: NumberLike,
  segment: Partial<Segment>,
  layerName: string,
  timestamp: number = Date.now(),
  createsNewUndoState: boolean = false,
) => {
  if (segmentId == null) {
    throw new Error("Segment ID must not be null.");
  }
  return {
    type: "UPDATE_SEGMENT",
    // TODO: Proper 64 bit support (#6921)
    segmentId: Number(segmentId),
    segment,
    layerName,
    timestamp,
    createsNewUndoState,
  } as const;
};

export const removeSegmentAction = (
  segmentId: NumberLike,
  layerName: string,
  timestamp: number = Date.now(),
) =>
  ({
    type: "REMOVE_SEGMENT",
    // TODO: Proper 64 bit support (#6921)
    segmentId: Number(segmentId),
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

export const setExpandedSegmentGroupsAction = (
  expandedSegmentGroups: Set<string>,
  layerName: string,
) =>
  ({
    type: "SET_EXPANDED_SEGMENT_GROUPS",
    expandedSegmentGroups,
    layerName,
  }) as const;

export const toggleSegmentGroupAction = (groupId: number, layerName: string) =>
  ({
    type: "TOGGLE_SEGMENT_GROUP",
    groupId,
    layerName,
  }) as const;

export const toggleAllSegmentsAction = (layerName: string, isVisible?: boolean) =>
  ({
    type: "TOGGLE_ALL_SEGMENTS",
    layerName,
    isVisible,
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

export const addBucketToUndoAction = (bucketSnapshot: BucketSnapshot) =>
  ({
    type: "ADD_BUCKET_TO_UNDO",
    bucketSnapshot,
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

export const setHasEditableMappingAction = (tracingId: string) =>
  ({
    type: "SET_HAS_EDITABLE_MAPPING",
    tracingId,
  }) as const;

export const setMappingIsLockedAction = (tracingId: string) =>
  ({
    type: "SET_MAPPING_IS_LOCKED",
    tracingId,
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

export const computeQuickSelectForPointAction = (
  position: Vector3,
  quickSelectGeometry: QuickSelectGeometry,
) =>
  ({
    type: "COMPUTE_QUICK_SELECT_FOR_POINT",
    position,
    quickSelectGeometry,
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

export const setVolumeBucketDataHasChangedAction = (tracingId: string) =>
  ({
    type: "SET_VOLUME_BUCKET_DATA_HAS_CHANGED",
    tracingId,
  }) as const;

export const applyVolumeUpdateActionsFromServerAction = (
  actions: Array<ApplicableVolumeUpdateAction>,
) =>
  ({
    type: "APPLY_VOLUME_UPDATE_ACTIONS_FROM_SERVER",
    actions,
  }) as const;
