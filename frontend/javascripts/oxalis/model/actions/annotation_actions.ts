import type {
  APIAnnotation,
  APIAnnotationVisibility,
  APIDataLayer,
  APIDataset,
  APIMeshFile,
  APIUserCompact,
  EditableLayerProperties,
} from "types/api_flow_types";
import type {
  MappingType,
  UserBoundingBox,
  UserBoundingBoxWithoutId,
  UserBoundingBoxWithoutIdMaybe,
} from "oxalis/store";
import type { Vector3 } from "oxalis/constants";
import _ from "lodash";
import { Dispatch } from "redux";
import Deferred from "libs/async/deferred";
import { type AdditionalCoordinate } from "types/api_flow_types";

type InitializeAnnotationAction = ReturnType<typeof initializeAnnotationAction>;
type SetAnnotationNameAction = ReturnType<typeof setAnnotationNameAction>;
type SetAnnotationVisibilityAction = ReturnType<typeof setAnnotationVisibilityAction>;
export type EditAnnotationLayerAction = ReturnType<typeof editAnnotationLayerAction>;
type SetAnnotationDescriptionAction = ReturnType<typeof setAnnotationDescriptionAction>;
type SetAnnotationAllowUpdateAction = ReturnType<typeof setAnnotationAllowUpdateAction>;
type SetBlockedByUserAction = ReturnType<typeof setBlockedByUserAction>;
type SetUserBoundingBoxesAction = ReturnType<typeof setUserBoundingBoxesAction>;
type FinishedResizingUserBoundingBoxAction = ReturnType<
  typeof finishedResizingUserBoundingBoxAction
>;
type AddUserBoundingBoxesAction = ReturnType<typeof addUserBoundingBoxesAction>;
type AddNewUserBoundingBox = ReturnType<typeof addUserBoundingBoxAction>;
type ChangeUserBoundingBoxAction = ReturnType<typeof changeUserBoundingBoxAction>;
type DeleteUserBoundingBox = ReturnType<typeof deleteUserBoundingBoxAction>;
export type UpdateMeshVisibilityAction = ReturnType<typeof updateMeshVisibilityAction>;
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
export type SetOthersMayEditForAnnotationAction = ReturnType<
  typeof setOthersMayEditForAnnotationAction
>;

export type AnnotationActionTypes =
  | InitializeAnnotationAction
  | SetAnnotationNameAction
  | SetAnnotationVisibilityAction
  | EditAnnotationLayerAction
  | SetAnnotationDescriptionAction
  | SetAnnotationAllowUpdateAction
  | SetBlockedByUserAction
  | SetUserBoundingBoxesAction
  | ChangeUserBoundingBoxAction
  | FinishedResizingUserBoundingBoxAction
  | AddNewUserBoundingBox
  | DeleteUserBoundingBox
  | AddUserBoundingBoxesAction
  | MaybeFetchMeshFilesAction
  | UpdateMeshVisibilityAction
  | TriggerMeshDownloadAction
  | RefreshMeshesAction
  | RefreshMeshAction
  | StartedLoadingMeshAction
  | FinishedLoadingMeshAction
  | UpdateMeshFileListAction
  | UpdateCurrentMeshFileAction
  | RemoveMeshAction
  | AddAdHocMeshAction
  | AddPrecomputedMeshAction
  | SetOthersMayEditForAnnotationAction;

export type UserBoundingBoxAction =
  | SetUserBoundingBoxesAction
  | AddNewUserBoundingBox
  | DeleteUserBoundingBox
  | AddUserBoundingBoxesAction
  | FinishedResizingUserBoundingBoxAction;

export const AllUserBoundingBoxActions = [
  "SET_USER_BOUNDING_BOXES",
  "ADD_NEW_USER_BOUNDING_BOX",
  "CHANGE_USER_BOUNDING_BOX",
  "FINISHED_RESIZING_USER_BOUNDING_BOX",
  "DELETE_USER_BOUNDING_BOX",
  "ADD_USER_BOUNDING_BOXES",
];
export const initializeAnnotationAction = (annotation: APIAnnotation) =>
  ({
    type: "INITIALIZE_ANNOTATION",
    annotation,
  }) as const;

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

export const setAnnotationAllowUpdateAction = (allowUpdate: boolean) =>
  ({
    type: "SET_ANNOTATION_ALLOW_UPDATE",
    allowUpdate,
  }) as const;

export const setBlockedByUserAction = (blockedByUser: APIUserCompact | null | undefined) =>
  ({
    type: "SET_BLOCKED_BY_USER",
    blockedByUser,
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

export const addUserBoundingBoxesAction = (userBoundingBoxes: Array<UserBoundingBox>) =>
  ({
    type: "ADD_USER_BOUNDING_BOXES",
    userBoundingBoxes,
  }) as const;

export const updateMeshVisibilityAction = (
  layerName: string,
  id: number,
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

export const maybeFetchMeshFilesAction = (
  segmentationLayer: APIDataLayer | null | undefined,
  dataset: APIDataset,
  mustRequest: boolean,
  autoActivate: boolean = true,
  callback: (meshes: Array<APIMeshFile>) => void = _.noop,
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
  segmentId: number,
  layerName: string,
) =>
  ({
    type: "TRIGGER_MESH_DOWNLOAD",
    segmentName,
    segmentId,
    layerName,
  }) as const;

export const triggerMeshesDownloadAction = (
  segmentsArray: Array<{ segmentName: string; segmentId: number; layerName: string }>,
) =>
  ({
    type: "TRIGGER_MESHES_DOWNLOAD",
    segmentsArray,
  }) as const;

export const refreshMeshesAction = () =>
  ({
    type: "REFRESH_MESHES",
  }) as const;

export const refreshMeshAction = (layerName: string, segmentId: number) =>
  ({
    type: "REFRESH_MESH",
    layerName,
    segmentId,
  }) as const;

export const startedLoadingMeshAction = (layerName: string, segmentId: number) =>
  ({
    type: "STARTED_LOADING_MESH",
    layerName,
    segmentId,
  }) as const;

export const finishedLoadingMeshAction = (layerName: string, segmentId: number) =>
  ({
    type: "FINISHED_LOADING_MESH",
    layerName,
    segmentId,
  }) as const;

export const updateMeshFileListAction = (layerName: string, meshFiles: Array<APIMeshFile>) =>
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

export const removeMeshAction = (layerName: string, segmentId: number) =>
  ({
    type: "REMOVE_MESH",
    layerName,
    segmentId,
  }) as const;

export const addAdHocMeshAction = (
  layerName: string,
  segmentId: number,
  seedPosition: Vector3,
  seedAdditionalCoordinates: AdditionalCoordinate[] | undefined | null,
  mappingName: string | null | undefined,
  mappingType: MappingType | null | undefined,
) =>
  ({
    type: "ADD_AD_HOC_MESH",
    layerName,
    segmentId,
    seedPosition,
    seedAdditionalCoordinates,
    mappingName,
    mappingType,
  }) as const;

export const addPrecomputedMeshAction = (
  layerName: string,
  segmentId: number,
  seedPosition: Vector3,
  seedAdditionalCoordinates: AdditionalCoordinate[] | undefined | null,
  meshFileName: string,
  areChunksMerged: boolean,
  mappingName: string | null | undefined,
) =>
  ({
    type: "ADD_PRECOMPUTED_MESH",
    layerName,
    segmentId,
    seedPosition,
    seedAdditionalCoordinates,
    meshFileName,
    areChunksMerged,
    mappingName,
  }) as const;

export const setOthersMayEditForAnnotationAction = (othersMayEdit: boolean) =>
  ({
    type: "SET_OTHERS_MAY_EDIT_FOR_ANNOTATION",
    othersMayEdit,
  }) as const;

export const dispatchMaybeFetchMeshFilesAsync = async (
  dispatch: Dispatch<any>,
  segmentationLayer: APIDataLayer | null | undefined,
  dataset: APIDataset,
  mustRequest: boolean,
  autoActivate: boolean = true,
): Promise<Array<APIMeshFile>> => {
  const readyDeferred = new Deferred<APIMeshFile[], unknown>();
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
