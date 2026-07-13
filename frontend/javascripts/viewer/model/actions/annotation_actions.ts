import Deferred from "libs/async/deferred";
import noop from "lodash-es/noop";
import type { Dispatch } from "redux";
import { batchActions } from "redux-batched-actions";
import type {
  AdditionalCoordinate,
  AnnotationCollaborationMode,
  APIAnnotationVisibility,
  APIDataLayer,
  APIDataset,
  APIMeshFileInfo,
  EditableLayerProperties,
} from "types/api_types";
import type { Vector3 } from "viewer/constants";
import Constants from "viewer/constants";
import type {
  Annotation,
  MappingType,
  MipLayerConfig,
  UserBoundingBox,
  UserBoundingBoxWithoutId,
  UserBoundingBoxWithoutIdMaybe,
} from "viewer/store";
import type { Action } from "./actions";
import type { InitializeSkeletonTracingAction } from "./skeletontracing_actions";
import type {
  InitializeEditableMappingAction,
  InitializeVolumeTracingAction,
} from "./volumetracing_actions";

type InitializeAnnotationAction = ReturnType<typeof initializeAnnotationAction>;
type InitializationAction =
  | InitializeAnnotationAction
  | InitializeSkeletonTracingAction
  | InitializeVolumeTracingAction
  | InitializeEditableMappingAction;

// This BatchedAnnotationInitializationAction should be used
// when initializing the annotation. This is important especially when
// switching between annotation versions with the version-restore view.
// Otherwise, there can be listeners that act too eagerly after the first
// initialization action was dispatched and try to access data that is not
// there yet (because the other initialization actions were not dispatched yet).
export type BatchedAnnotationInitializationAction = {
  type: "INITIALIZE_ANNOTATION_WITH_TRACINGS";
  payload: InitializationAction[];
  meta: {
    batch: true;
  };
};
export type SetAnnotationNameAction = ReturnType<typeof setAnnotationNameAction>;
type SetAnnotationVisibilityAction = ReturnType<typeof setAnnotationVisibilityAction>;
export type EditAnnotationLayerAction = ReturnType<typeof editAnnotationLayerAction>;
export type SetAnnotationDescriptionAction = ReturnType<typeof setAnnotationDescriptionAction>;
type SetAnnotationAllowUpdateAction = ReturnType<
  typeof setIsUpdatingAnnotationCurrentlyAllowedAction
>;
type SetUserBoundingBoxesAction = ReturnType<typeof setUserBoundingBoxesAction>;
type FinishedResizingUserBoundingBoxAction = ReturnType<
  typeof finishedResizingUserBoundingBoxAction
>;
type AddUserBoundingBoxesAction = ReturnType<typeof addUserBoundingBoxesAction>;
export type AddNewUserBoundingBox = ReturnType<typeof addUserBoundingBoxAction>;
export type ChangeUserBoundingBoxAction = ReturnType<typeof changeUserBoundingBoxAction>;
type DeleteUserBoundingBox = ReturnType<typeof deleteUserBoundingBoxAction>;
export type SetMipForBBoxAction = ReturnType<typeof setMipForBBoxAction>;
export type RemoveMipForBBoxAction = ReturnType<typeof removeMipForBBoxAction>;
export type RemoveMipLayerForBBoxAction = ReturnType<typeof removeMipLayerForBBoxAction>;
export type LoadMipAction = ReturnType<typeof loadMipAction>;
export type UpdateMeshVisibilityAction = ReturnType<typeof updateMeshVisibilityAction>;
export type UpdateMeshOpacityAction = ReturnType<typeof updateMeshOpacityAction>;
export type MaybeFetchMeshFilesAction = ReturnType<typeof maybeFetchMeshFilesAction>;
export type TriggerMeshDownloadAction = ReturnType<typeof triggerMeshDownloadAction>;
export type TriggerMeshesDownloadAction = ReturnType<typeof triggerMeshesDownloadAction>;
export type RefreshMeshesAction = ReturnType<typeof refreshMeshesAction>;
export type RefreshMeshAction = ReturnType<typeof refreshMeshAction>;
export type StartedLoadingMeshAction = ReturnType<typeof startedLoadingMeshAction>;
export type FinishedLoadingMeshAction = ReturnType<typeof finishedLoadingMeshAction>;
export type UpdateMeshFileListAction = ReturnType<typeof updateMeshFileListAction>;
export type UpdateCurrentMeshFileAction = ReturnType<typeof updateCurrentMeshFileAction>;
export type RemoveMeshAction = ReturnType<typeof removeMeshAction>;
export type AddAdHocMeshAction = ReturnType<typeof addAdHocMeshAction>;
export type AddPrecomputedMeshAction = ReturnType<typeof addPrecomputedMeshAction>;
export type SetCollaborationModeAction = ReturnType<typeof setCollaborationModeAction>;

export type AnnotationActionTypes =
  | InitializeAnnotationAction
  | BatchedAnnotationInitializationAction
  | SetAnnotationNameAction
  | SetAnnotationVisibilityAction
  | EditAnnotationLayerAction
  | SetAnnotationDescriptionAction
  | SetAnnotationAllowUpdateAction
  | SetUserBoundingBoxesAction
  | ChangeUserBoundingBoxAction
  | FinishedResizingUserBoundingBoxAction
  | AddNewUserBoundingBox
  | DeleteUserBoundingBox
  | AddUserBoundingBoxesAction
  | MaybeFetchMeshFilesAction
  | UpdateMeshVisibilityAction
  | UpdateMeshOpacityAction
  | TriggerMeshDownloadAction
  | TriggerMeshesDownloadAction
  | RefreshMeshesAction
  | RefreshMeshAction
  | StartedLoadingMeshAction
  | FinishedLoadingMeshAction
  | UpdateMeshFileListAction
  | UpdateCurrentMeshFileAction
  | RemoveMeshAction
  | AddAdHocMeshAction
  | AddPrecomputedMeshAction
  | SetCollaborationModeAction
  | SetMipForBBoxAction
  | RemoveMipForBBoxAction
  | RemoveMipLayerForBBoxAction
  | LoadMipAction;

export type UserBoundingBoxAction =
  | SetUserBoundingBoxesAction
  | AddNewUserBoundingBox
  | DeleteUserBoundingBox
  | AddUserBoundingBoxesAction
  | FinishedResizingUserBoundingBoxAction;

export const AllUserBoundingBoxActions: Action["type"][] = [
  "SET_USER_BOUNDING_BOXES",
  "ADD_NEW_USER_BOUNDING_BOX",
  "CHANGE_USER_BOUNDING_BOX",
  "FINISHED_RESIZING_USER_BOUNDING_BOX",
  "DELETE_USER_BOUNDING_BOX",
  "ADD_USER_BOUNDING_BOXES",
];
export const initializeAnnotationAction = (annotation: Annotation) =>
  ({
    type: "INITIALIZE_ANNOTATION",
    annotation,
  }) as const;

export const batchedAnnotationInitializationAction = (actions: Array<InitializationAction>) =>
  batchActions(
    actions,
    "INITIALIZE_ANNOTATION_WITH_TRACINGS",
  ) as unknown as BatchedAnnotationInitializationAction;

export const setAnnotationNameAction = (name: string) =>
  ({
    type: "SET_ANNOTATION_NAME",
    name,
  }) as const;

export const setAnnotationVisibilityAction = (visibility: APIAnnotationVisibility) =>
  ({
    type: "SET_ANNOTATION_VISIBILITY",
    visibility,
  }) as const;

export const editAnnotationLayerAction = (
  tracingId: string,
  layerProperties: EditableLayerProperties,
) =>
  ({
    type: "EDIT_ANNOTATION_LAYER",
    tracingId,
    layerProperties,
  }) as const;

export const setAnnotationDescriptionAction = (description: string) =>
  ({
    type: "SET_ANNOTATION_DESCRIPTION",
    description,
  }) as const;

export const setIsUpdatingAnnotationCurrentlyAllowedAction = (currentlyAllowUpdate: boolean) =>
  ({
    type: "SET_ANNOTATION_ALLOW_UPDATE",
    currentlyAllowUpdate,
  }) as const;

// Strictly speaking this is no annotation action but a tracing action, as the boundingBox is saved with
// the tracing, hence no ANNOTATION in the action type.
export const setUserBoundingBoxesAction = (userBoundingBoxes: Array<UserBoundingBox>) =>
  ({
    type: "SET_USER_BOUNDING_BOXES",
    userBoundingBoxes,
  }) as const;

export const changeUserBoundingBoxAction = (id: number, newProps: UserBoundingBoxWithoutIdMaybe) =>
  ({
    type: "CHANGE_USER_BOUNDING_BOX",
    id,
    newProps,
  }) as const;

export const finishedResizingUserBoundingBoxAction = (id: number) =>
  ({
    type: "FINISHED_RESIZING_USER_BOUNDING_BOX",
    id,
  }) as const;

export const addUserBoundingBoxAction = (
  newBoundingBox?: Partial<UserBoundingBoxWithoutId> | null | undefined,
  center?: Vector3,
) =>
  ({
    type: "ADD_NEW_USER_BOUNDING_BOX",
    newBoundingBox,
    center,
  }) as const;

export const deleteUserBoundingBoxAction = (id: number) =>
  ({
    type: "DELETE_USER_BOUNDING_BOX",
    id,
  }) as const;

export const setMipForBBoxAction = (id: number, config: MipLayerConfig) =>
  ({
    type: "SET_MIP_FOR_BBOX",
    id,
    config,
  }) as const;

export const removeMipForBBoxAction = (id: number) =>
  ({
    type: "REMOVE_MIP_FOR_BBOX",
    id,
  }) as const;

export const removeMipLayerForBBoxAction = (id: number, layerName: string) =>
  ({
    type: "REMOVE_MIP_LAYER_FOR_BBOX",
    id,
    layerName,
  }) as const;

// Dispatched by scene_controller when a new MIP layer slot is ready for data download.
// The MIP saga picks this up, downloads the data, and calls volume.receiveLayerData.
export const loadMipAction = (bboxId: number, bbox: UserBoundingBox, config: MipLayerConfig) =>
  ({
    type: "LOAD_MIP",
    bboxId,
    bbox,
    config,
  }) as const;

export const addUserBoundingBoxesAction = (userBoundingBoxes: Array<UserBoundingBox>) =>
  ({
    type: "ADD_USER_BOUNDING_BOXES",
    userBoundingBoxes,
  }) as const;

export const updateMeshVisibilityAction = (
  layerName: string,
  id: bigint,
  visibility: boolean,
  additionalCoordinates?: AdditionalCoordinate[] | undefined | null,
) =>
  ({
    type: "UPDATE_MESH_VISIBILITY",
    layerName,
    id,
    visibility,
    additionalCoordinates,
  }) as const;

export const updateMeshOpacityAction = (layerName: string, id: bigint, opacity: number) =>
  ({
    type: "UPDATE_MESH_OPACITY",
    id,
    layerName,
    opacity,
  }) as const;

export const maybeFetchMeshFilesAction = (
  segmentationLayer: APIDataLayer | null | undefined,
  dataset: APIDataset,
  mustRequest: boolean,
  autoActivate: boolean = true,
  callback: (meshes: Array<APIMeshFileInfo>) => void = noop,
) =>
  ({
    type: "MAYBE_FETCH_MESH_FILES",
    segmentationLayer,
    dataset,
    mustRequest,
    autoActivate,
    callback,
  }) as const;

export const triggerMeshDownloadAction = (
  segmentName: string,
  segmentId: bigint,
  layerName: string,
) =>
  ({
    type: "TRIGGER_MESH_DOWNLOAD",
    segmentName,
    segmentId,
    layerName,
  }) as const;

export const triggerMeshesDownloadAction = (
  segmentsArray: Array<{ segmentName: string; segmentId: bigint; layerName: string }>,
) =>
  ({
    type: "TRIGGER_MESHES_DOWNLOAD",
    segmentsArray,
  }) as const;

export const refreshMeshesAction = () =>
  ({
    type: "REFRESH_MESHES",
  }) as const;

export const refreshMeshAction = (layerName: string, segmentId: bigint) =>
  ({
    type: "REFRESH_MESH",
    layerName,
    segmentId,
  }) as const;

export const startedLoadingMeshAction = (layerName: string, segmentId: bigint) =>
  ({
    type: "STARTED_LOADING_MESH",
    layerName,
    segmentId,
  }) as const;

export const finishedLoadingMeshAction = (layerName: string, segmentId: bigint) =>
  ({
    type: "FINISHED_LOADING_MESH",
    layerName,
    segmentId,
  }) as const;

export const updateMeshFileListAction = (layerName: string, meshFiles: Array<APIMeshFileInfo>) =>
  ({
    type: "UPDATE_MESH_FILE_LIST",
    layerName,
    meshFiles,
  }) as const;

export const updateCurrentMeshFileAction = (
  layerName: string,
  meshFileName: string | null | undefined,
) =>
  ({
    type: "UPDATE_CURRENT_MESH_FILE",
    layerName,
    meshFileName,
  }) as const;

export const removeMeshAction = (layerName: string, segmentId: bigint) =>
  ({
    type: "REMOVE_MESH",
    layerName,
    segmentId,
  }) as const;

export const addAdHocMeshAction = (
  layerName: string,
  segmentId: bigint,
  seedPosition: Vector3,
  seedAdditionalCoordinates: AdditionalCoordinate[] | undefined | null,
  mappingName: string | null | undefined,
  mappingType: MappingType | null | undefined,
  opacity: number | undefined,
  isVisible: boolean | undefined,
) =>
  ({
    type: "ADD_AD_HOC_MESH",
    layerName,
    segmentId,
    seedPosition,
    seedAdditionalCoordinates,
    mappingName,
    mappingType,
    opacity: opacity ?? Constants.DEFAULT_MESH_OPACITY,
    isVisible: isVisible ?? true,
  }) as const;

export const addPrecomputedMeshAction = (
  layerName: string,
  segmentId: bigint,
  seedPosition: Vector3,
  seedAdditionalCoordinates: AdditionalCoordinate[] | undefined | null,
  meshFileName: string,
  mappingName: string | null | undefined,
  opacity: number | undefined,
  isVisible: boolean | undefined,
) =>
  ({
    type: "ADD_PRECOMPUTED_MESH",
    layerName,
    segmentId,
    seedPosition,
    seedAdditionalCoordinates,
    meshFileName,
    mappingName,
    opacity: opacity ?? Constants.DEFAULT_MESH_OPACITY,
    isVisible: isVisible ?? true,
  }) as const;

export const setCollaborationModeAction = (collaborationMode: AnnotationCollaborationMode) =>
  ({
    type: "SET_COLLABORATION_MODE",
    collaborationMode,
  }) as const;

export const showManyBucketUpdatesWarningAction = () =>
  ({
    type: "SHOW_MANY_BUCKET_UPDATES_WARNING",
  }) as const;

export const dispatchMaybeFetchMeshFilesAsync = async (
  dispatch: Dispatch<any>,
  segmentationLayer: APIDataLayer | null | undefined,
  dataset: APIDataset,
  mustRequest: boolean,
  autoActivate: boolean = true,
): Promise<Array<APIMeshFileInfo>> => {
  const readyDeferred = new Deferred<APIMeshFileInfo[], unknown>();
  const action = maybeFetchMeshFilesAction(
    segmentationLayer,
    dataset,
    mustRequest,
    autoActivate,
    (meshes) => readyDeferred.resolve(meshes),
  );
  dispatch(action);
  return readyDeferred.promise();
};
