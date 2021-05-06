// @flow
import type {
  APIAnnotation,
  LocalMeshMetaData,
  MeshMetaData,
  RemoteMeshMetaData,
  APIAnnotationVisibility,
} from "types/api_flow_types";
import type { Vector3 } from "oxalis/constants";
import type { UserBoundingBox } from "oxalis/store";

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

type AddUserBoundingBoxesAction = {
  type: "ADD_USER_BOUNDING_BOXES",
  userBoundingBoxes: Array<UserBoundingBox>,
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
  cellId: number,
};
export type StartRefreshingIsosurfaceAction = {
  type: "START_REFRESHING_ISOSURFACE",
  cellId: number,
};
export type FinishedRefreshingIsosurfaceAction = {
  type: "FINISHED_REFRESHING_ISOSURFACE",
  cellId: number,
};

export type ImportIsosurfaceFromStlAction = {
  type: "IMPORT_ISOSURFACE_FROM_STL",
  buffer: ArrayBuffer,
};

export type RemoveIsosurfaceAction = {
  type: "REMOVE_ISOSURFACE",
  cellId: number,
};

export type AddIsosurfaceAction = {
  type: "ADD_ISOSURFACE",
  cellId: number,
  seedPosition: Vector3,
  isPrecomputed: boolean,
  fileName?: string,
};

export type AnnotationActionTypes =
  | InitializeAnnotationAction
  | SetAnnotationNameAction
  | SetAnnotationVisibilityAction
  | SetAnnotationDescriptionAction
  | SetAnnotationAllowUpdateAction
  | UpdateRemoteMeshMetaDataAction
  | SetUserBoundingBoxesAction
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
  | StartRefreshingIsosurfaceAction
  | FinishedRefreshingIsosurfaceAction
  | ImportIsosurfaceFromStlAction
  | RemoveIsosurfaceAction
  | AddIsosurfaceAction;

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
  id: number,
  visibility: boolean,
): UpdateIsosurfaceVisibilityAction => ({
  type: "UPDATE_ISOSURFACE_VISIBILITY",
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

export const refreshIsosurfaceAction = (cellId: number): RefreshIsosurfaceAction => ({
  type: "REFRESH_ISOSURFACE",
  cellId,
});

export const startRefreshingIsosurfaceAction = (
  cellId: number,
): StartRefreshingIsosurfaceAction => ({
  type: "START_REFRESHING_ISOSURFACE",
  cellId,
});

export const finishedRefreshingIsosurfaceAction = (
  cellId: number,
): FinishedRefreshingIsosurfaceAction => ({
  type: "FINISHED_REFRESHING_ISOSURFACE",
  cellId,
});

export const importIsosurfaceFromStlAction = (
  buffer: ArrayBuffer,
): ImportIsosurfaceFromStlAction => ({
  type: "IMPORT_ISOSURFACE_FROM_STL",
  buffer,
});

export const removeIsosurfaceAction = (cellId: number): RemoveIsosurfaceAction => ({
  type: "REMOVE_ISOSURFACE",
  cellId,
});

export const addIsosurfaceAction = (
  cellId: number,
  seedPosition: Vector3,
  isPrecomputed: boolean,
  fileName?: string,
): AddIsosurfaceAction => ({
  type: "ADD_ISOSURFACE",
  cellId,
  seedPosition,
  isPrecomputed,
  fileName,
});
