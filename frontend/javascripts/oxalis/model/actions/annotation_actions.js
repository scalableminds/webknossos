// @flow
import type {
  APIAnnotation,
  LocalMeshMetaData,
  MeshMetaData,
  RemoteMeshMetaData,
} from "admin/api_flow_types";
import type { BoundingBoxType } from "oxalis/constants";

type InitializeAnnotation = {
  type: "INITIALIZE_ANNOTATION",
  annotation: APIAnnotation,
};

type SetAnnotationNameAction = {
  type: "SET_ANNOTATION_NAME",
  name: string,
};

type SetAnnotationPublicAction = {
  type: "SET_ANNOTATION_PUBLIC",
  isPublic: boolean,
};

type SetAnnotationDescriptionAction = {
  type: "SET_ANNOTATION_DESCRIPTION",
  description: string,
};

type SetAnnotationAllowUpdateAction = {
  type: "SET_ANNOTATION_ALLOW_UPDATE",
  allowUpdate: boolean,
};

type SetUserBoundingBox = {
  type: "SET_USER_BOUNDING_BOX",
  userBoundingBox: ?BoundingBoxType,
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

export type AnnotationActionTypes =
  | InitializeAnnotation
  | SetAnnotationNameAction
  | SetAnnotationPublicAction
  | SetAnnotationDescriptionAction
  | SetAnnotationAllowUpdateAction
  | UpdateRemoteMeshMetaDataAction
  | SetUserBoundingBox
  | AddMeshMetadataAction
  | DeleteMeshAction
  | CreateMeshFromBufferAction
  | UpdateLocalMeshMetaDataAction;

export const initializeAnnotationAction = (annotation: APIAnnotation): InitializeAnnotation => ({
  type: "INITIALIZE_ANNOTATION",
  annotation,
});

export const setAnnotationNameAction = (name: string): SetAnnotationNameAction => ({
  type: "SET_ANNOTATION_NAME",
  name,
});

export const setAnnotationPublicAction = (isPublic: boolean): SetAnnotationPublicAction => ({
  type: "SET_ANNOTATION_PUBLIC",
  isPublic,
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
export const setUserBoundingBoxAction = (
  userBoundingBox: ?BoundingBoxType,
): SetUserBoundingBox => ({
  type: "SET_USER_BOUNDING_BOX",
  userBoundingBox,
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
