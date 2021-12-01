// @flow
import type {
  APIAnnotation,
  APIAnnotationVisibility,
  APIMeshFile,
  EditableLayerProperties,
  LocalMeshMetaData,
  MeshMetaData,
  RemoteMeshMetaData,
} from "types/api_flow_types";
import type {
  UserBoundingBox,
  UserBoundingBoxWithoutId,
  UserBoundingBoxWithoutIdMaybe,
} from "oxalis/store";
import type { Vector3 } from "oxalis/constants";

type InitializeAnnotationAction = {
  type: "INITIALIZE_ANNOTATION",
  annotation: APIAnnotation,
};

type SetAnnotationNameAction = {
  type: "SET_ANNOTATION_NAME",
  name: string,
};

type SetAnnotationVisibilityAction = {
  type: "SET_ANNOTATION_VISIBILITY",
  visibility: APIAnnotationVisibility,
};

export type EditAnnotationLayerAction = {
  type: "EDIT_ANNOTATION_LAYER",
  tracingId: string,
  layerProperties: EditableLayerProperties,
};

type SetAnnotationDescriptionAction = {
  type: "SET_ANNOTATION_DESCRIPTION",
  description: string,
};

type SetAnnotationAllowUpdateAction = {
  type: "SET_ANNOTATION_ALLOW_UPDATE",
  allowUpdate: boolean,
};

type SetUserBoundingBoxesAction = {
  type: "SET_USER_BOUNDING_BOXES",
  userBoundingBoxes: Array<UserBoundingBox>,
};

type FinishedResizingUserBoundingBoxAction = {
  type: "FINISHED_RESIZING_USER_BOUNDING_BOX",
  id: number,
};

type AddUserBoundingBoxesAction = {
  type: "ADD_USER_BOUNDING_BOXES",
  userBoundingBoxes: Array<UserBoundingBox>,
};

type AddNewUserBoundingBox = {
  type: "ADD_NEW_USER_BOUNDING_BOX",
  newBoundingBox?: ?UserBoundingBoxWithoutId,
  // Center is the passed position that the new bounding box should have as a center.
  // If no center is given, the flycam center will be taken.
  center?: Vector3,
};

type ChangeUserBoundingBoxAction = {
  type: "CHANGE_USER_BOUNDING_BOX",
  id: number,
  newProps: UserBoundingBoxWithoutIdMaybe,
};

type DeleteUserBoundingBox = {
  type: "DELETE_USER_BOUNDING_BOX",
  id: number,
};

export type UpdateRemoteMeshMetaDataAction = {
  type: "UPDATE_REMOTE_MESH_METADATA",
  id: string,
  meshShape: $Shape<RemoteMeshMetaData>,
};

export type UpdateLocalMeshMetaDataAction = {
  type: "UPDATE_LOCAL_MESH_METADATA",
  id: string,
  meshShape: $Shape<LocalMeshMetaData>,
};
export type UpdateIsosurfaceVisibilityAction = {
  type: "UPDATE_ISOSURFACE_VISIBILITY",
  layerName: string,
  id: number,
  visibility: boolean,
};

export type AddMeshMetadataAction = {
  type: "ADD_MESH_METADATA",
  mesh: MeshMetaData,
};

export type DeleteMeshAction = {
  type: "DELETE_MESH",
  id: string,
};

export type CreateMeshFromBufferAction = {
  type: "CREATE_MESH_FROM_BUFFER",
  buffer: ArrayBuffer,
  name: string,
};

export type TriggerActiveIsosurfaceDownloadAction = {
  type: "TRIGGER_ACTIVE_ISOSURFACE_DOWNLOAD",
};

export type TriggerIsosurfaceDownloadAction = {
  type: "TRIGGER_ISOSURFACE_DOWNLOAD",
  cellId: number,
};

export type RefreshIsosurfacesAction = {
  type: "REFRESH_ISOSURFACES",
};

export type FinishedRefreshingIsosurfacesAction = {
  type: "FINISHED_REFRESHING_ISOSURFACES",
};
export type RefreshIsosurfaceAction = {
  type: "REFRESH_ISOSURFACE",
  layerName: string,
  cellId: number,
};
export type StartedLoadingIsosurfaceAction = {
  type: "STARTED_LOADING_ISOSURFACE",
  layerName: string,
  cellId: number,
};
export type FinishedLoadingIsosurfaceAction = {
  type: "FINISHED_LOADING_ISOSURFACE",
  layerName: string,
  cellId: number,
};

export type UpdateMeshFileListAction = {
  type: "UPDATE_MESH_FILE_LIST",
  layerName: string,
  meshFiles: Array<APIMeshFile>,
};
export type UpdateCurrentMeshFileAction = {
  type: "UPDATE_CURRENT_MESH_FILE",
  layerName: string,
  meshFileName: ?string,
};

export type ImportIsosurfaceFromStlAction = {
  type: "IMPORT_ISOSURFACE_FROM_STL",
  layerName: string,
  buffer: ArrayBuffer,
};

export type RemoveIsosurfaceAction = {
  type: "REMOVE_ISOSURFACE",
  layerName: string,
  cellId: number,
};

export type AddIsosurfaceAction = {
  type: "ADD_ISOSURFACE",
  layerName: string,
  cellId: number,
  seedPosition: Vector3,
  isPrecomputed: boolean,
};

export type AnnotationActionTypes =
  | InitializeAnnotationAction
  | SetAnnotationNameAction
  | SetAnnotationVisibilityAction
  | EditAnnotationLayerAction
  | SetAnnotationDescriptionAction
  | SetAnnotationAllowUpdateAction
  | UpdateRemoteMeshMetaDataAction
  | SetUserBoundingBoxesAction
  | ChangeUserBoundingBoxAction
  | FinishedResizingUserBoundingBoxAction
  | AddNewUserBoundingBox
  | DeleteUserBoundingBox
  | AddUserBoundingBoxesAction
  | AddMeshMetadataAction
  | DeleteMeshAction
  | CreateMeshFromBufferAction
  | UpdateLocalMeshMetaDataAction
  | UpdateIsosurfaceVisibilityAction
  | TriggerActiveIsosurfaceDownloadAction
  | TriggerIsosurfaceDownloadAction
  | RefreshIsosurfacesAction
  | FinishedRefreshingIsosurfacesAction
  | RefreshIsosurfaceAction
  | StartedLoadingIsosurfaceAction
  | FinishedLoadingIsosurfaceAction
  | UpdateMeshFileListAction
  | UpdateCurrentMeshFileAction
  | ImportIsosurfaceFromStlAction
  | RemoveIsosurfaceAction
  | AddIsosurfaceAction;

export type UserBoundingBoxAction =
  | SetUserBoundingBoxesAction
  | AddNewUserBoundingBox
  | DeleteUserBoundingBox
  | AddUserBoundingBoxesAction;

export const AllUserBoundingBoxActions = [
  "SET_USER_BOUNDING_BOXES",
  "ADD_NEW_USER_BOUNDING_BOX",
  "CHANGE_USER_BOUNDING_BOX",
  "FINISHED_RESIZING_USER_BOUNDING_BOX",
  "DELETE_USER_BOUNDING_BOX",
  "ADD_USER_BOUNDING_BOXES",
];

export const initializeAnnotationAction = (
  annotation: APIAnnotation,
): InitializeAnnotationAction => ({
  type: "INITIALIZE_ANNOTATION",
  annotation,
});

export const setAnnotationNameAction = (name: string): SetAnnotationNameAction => ({
  type: "SET_ANNOTATION_NAME",
  name,
});

export const setAnnotationVisibilityAction = (
  visibility: APIAnnotationVisibility,
): SetAnnotationVisibilityAction => ({
  type: "SET_ANNOTATION_VISIBILITY",
  visibility,
});

export const editAnnotationLayerAction = (
  tracingId: string,
  layerProperties: EditableLayerProperties,
): EditAnnotationLayerAction => ({
  type: "EDIT_ANNOTATION_LAYER",
  tracingId,
  layerProperties,
});

export const setAnnotationDescriptionAction = (
  description: string,
): SetAnnotationDescriptionAction => ({
  type: "SET_ANNOTATION_DESCRIPTION",
  description,
});

export const setAnnotationAllowUpdateAction = (
  allowUpdate: boolean,
): SetAnnotationAllowUpdateAction => ({
  type: "SET_ANNOTATION_ALLOW_UPDATE",
  allowUpdate,
});

// Strictly speaking this is no annotation action but a tracing action, as the boundingBox is saved with
// the tracing, hence no ANNOTATION in the action type.
export const setUserBoundingBoxesAction = (
  userBoundingBoxes: Array<UserBoundingBox>,
): SetUserBoundingBoxesAction => ({
  type: "SET_USER_BOUNDING_BOXES",
  userBoundingBoxes,
});

export const changeUserBoundingBoxAction = (
  id: number,
  newProps: UserBoundingBoxWithoutIdMaybe,
): ChangeUserBoundingBoxAction => ({
  type: "CHANGE_USER_BOUNDING_BOX",
  id,
  newProps,
});

export const finishedResizingUserBoundingBoxAction = (
  id: number,
): FinishedResizingUserBoundingBoxAction => ({
  type: "FINISHED_RESIZING_USER_BOUNDING_BOX",
  id,
});

export const addUserBoundingBoxAction = (
  newBoundingBox?: ?UserBoundingBoxWithoutId,
  center?: Vector3,
): AddNewUserBoundingBox => ({
  type: "ADD_NEW_USER_BOUNDING_BOX",
  newBoundingBox,
  center,
});

export const deleteUserBoundingBoxAction = (id: number): DeleteUserBoundingBox => ({
  type: "DELETE_USER_BOUNDING_BOX",
  id,
});

export const addUserBoundingBoxesAction = (
  userBoundingBoxes: Array<UserBoundingBox>,
): AddUserBoundingBoxesAction => ({
  type: "ADD_USER_BOUNDING_BOXES",
  userBoundingBoxes,
});

export const updateRemoteMeshMetaDataAction = (
  id: string,
  meshShape: $Shape<RemoteMeshMetaData>,
): UpdateRemoteMeshMetaDataAction => ({
  type: "UPDATE_REMOTE_MESH_METADATA",
  id,
  meshShape,
});

export const updateLocalMeshMetaDataAction = (
  id: string,
  meshShape: $Shape<LocalMeshMetaData>,
): UpdateLocalMeshMetaDataAction => ({
  type: "UPDATE_LOCAL_MESH_METADATA",
  id,
  meshShape,
});
export const updateIsosurfaceVisibilityAction = (
  layerName: string,
  id: number,
  visibility: boolean,
): UpdateIsosurfaceVisibilityAction => ({
  type: "UPDATE_ISOSURFACE_VISIBILITY",
  layerName,
  id,
  visibility,
});
export const addMeshMetaDataAction = (mesh: MeshMetaData): AddMeshMetadataAction => ({
  type: "ADD_MESH_METADATA",
  mesh,
});

export const deleteMeshAction = (id: string): DeleteMeshAction => ({
  type: "DELETE_MESH",
  id,
});

export const createMeshFromBufferAction = (
  name: string,
  buffer: ArrayBuffer,
): CreateMeshFromBufferAction => ({
  type: "CREATE_MESH_FROM_BUFFER",
  buffer,
  name,
});

export const triggerActiveIsosurfaceDownloadAction = (): TriggerActiveIsosurfaceDownloadAction => ({
  type: "TRIGGER_ACTIVE_ISOSURFACE_DOWNLOAD",
});

export const triggerIsosurfaceDownloadAction = (
  cellId: number,
): TriggerIsosurfaceDownloadAction => ({
  type: "TRIGGER_ISOSURFACE_DOWNLOAD",
  cellId,
});

export const refreshIsosurfacesAction = (): RefreshIsosurfacesAction => ({
  type: "REFRESH_ISOSURFACES",
});

export const finishedRefreshingIsosurfacesAction = (): FinishedRefreshingIsosurfacesAction => ({
  type: "FINISHED_REFRESHING_ISOSURFACES",
});

export const refreshIsosurfaceAction = (
  layerName: string,
  cellId: number,
): RefreshIsosurfaceAction => ({
  type: "REFRESH_ISOSURFACE",
  layerName,
  cellId,
});

export const startedLoadingIsosurfaceAction = (
  layerName: string,
  cellId: number,
): StartedLoadingIsosurfaceAction => ({
  type: "STARTED_LOADING_ISOSURFACE",
  layerName,
  cellId,
});

export const finishedLoadingIsosurfaceAction = (
  layerName: string,
  cellId: number,
): FinishedLoadingIsosurfaceAction => ({
  type: "FINISHED_LOADING_ISOSURFACE",
  layerName,
  cellId,
});

export const updateMeshFileListAction = (
  layerName: string,
  meshFiles: Array<APIMeshFile>,
): UpdateMeshFileListAction => ({
  type: "UPDATE_MESH_FILE_LIST",
  layerName,
  meshFiles,
});

export const updateCurrentMeshFileAction = (
  layerName: string,
  meshFileName: ?string,
): UpdateCurrentMeshFileAction => ({
  type: "UPDATE_CURRENT_MESH_FILE",
  layerName,
  meshFileName,
});

export const importIsosurfaceFromStlAction = (
  layerName: string,
  buffer: ArrayBuffer,
): ImportIsosurfaceFromStlAction => ({
  type: "IMPORT_ISOSURFACE_FROM_STL",
  layerName,
  buffer,
});

export const removeIsosurfaceAction = (
  layerName: string,
  cellId: number,
): RemoveIsosurfaceAction => ({
  type: "REMOVE_ISOSURFACE",
  layerName,
  cellId,
});

export const addIsosurfaceAction = (
  layerName: string,
  cellId: number,
  seedPosition: Vector3,
  isPrecomputed: boolean,
): AddIsosurfaceAction => ({
  type: "ADD_ISOSURFACE",
  layerName,
  cellId,
  seedPosition,
  isPrecomputed,
});
