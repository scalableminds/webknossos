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
  MappingType,
  UserBoundingBox,
  UserBoundingBoxWithoutId,
  UserBoundingBoxWithoutIdMaybe,
} from "oxalis/store";
import type { NumberOrBig, Vector3 } from "oxalis/constants";

type InitializeAnnotationAction = ReturnType<typeof initializeAnnotationAction>;
type SetAnnotationNameAction = ReturnType<typeof setAnnotationNameAction>;
type SetAnnotationVisibilityAction = ReturnType<typeof setAnnotationVisibilityAction>;
export type EditAnnotationLayerAction = ReturnType<typeof editAnnotationLayerAction>;
type SetAnnotationDescriptionAction = ReturnType<typeof setAnnotationDescriptionAction>;
type SetAnnotationAllowUpdateAction = ReturnType<typeof setAnnotationAllowUpdateAction>;
type SetUserBoundingBoxesAction = ReturnType<typeof setUserBoundingBoxesAction>;
type FinishedResizingUserBoundingBoxAction = ReturnType<
  typeof finishedResizingUserBoundingBoxAction
>;
type AddUserBoundingBoxesAction = ReturnType<typeof addUserBoundingBoxesAction>;
type AddNewUserBoundingBox = ReturnType<typeof addUserBoundingBoxAction>;
type ChangeUserBoundingBoxAction = ReturnType<typeof changeUserBoundingBoxAction>;
type DeleteUserBoundingBox = ReturnType<typeof deleteUserBoundingBoxAction>;
export type UpdateRemoteMeshMetaDataAction = ReturnType<typeof updateRemoteMeshMetaDataAction>;
export type UpdateLocalMeshMetaDataAction = ReturnType<typeof updateLocalMeshMetaDataAction>;
export type UpdateIsosurfaceVisibilityAction = ReturnType<typeof updateIsosurfaceVisibilityAction>;
export type AddMeshMetadataAction = ReturnType<typeof addMeshMetaDataAction>;
export type DeleteMeshAction = ReturnType<typeof deleteMeshAction>;
export type CreateMeshFromBufferAction = ReturnType<typeof createMeshFromBufferAction>;
export type TriggerIsosurfaceDownloadAction = ReturnType<typeof triggerIsosurfaceDownloadAction>;
export type RefreshIsosurfacesAction = ReturnType<typeof refreshIsosurfacesAction>;
export type RefreshIsosurfaceAction = ReturnType<typeof refreshIsosurfaceAction>;
export type StartedLoadingIsosurfaceAction = ReturnType<typeof startedLoadingIsosurfaceAction>;
export type FinishedLoadingIsosurfaceAction = ReturnType<typeof finishedLoadingIsosurfaceAction>;
export type UpdateMeshFileListAction = ReturnType<typeof updateMeshFileListAction>;
export type UpdateCurrentMeshFileAction = ReturnType<typeof updateCurrentMeshFileAction>;
export type ImportIsosurfaceFromStlAction = ReturnType<typeof importIsosurfaceFromStlAction>;
export type RemoveIsosurfaceAction = ReturnType<typeof removeIsosurfaceAction>;
export type AddAdHocIsosurfaceAction = ReturnType<typeof addAdHocIsosurfaceAction>;
export type AddPrecomputedIsosurfaceAction = ReturnType<typeof addPrecomputedIsosurfaceAction>;
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
  | TriggerIsosurfaceDownloadAction
  | RefreshIsosurfacesAction
  | RefreshIsosurfaceAction
  | StartedLoadingIsosurfaceAction
  | FinishedLoadingIsosurfaceAction
  | UpdateMeshFileListAction
  | UpdateCurrentMeshFileAction
  | ImportIsosurfaceFromStlAction
  | RemoveIsosurfaceAction
  | AddAdHocIsosurfaceAction
  | AddPrecomputedIsosurfaceAction
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
  } as const);

export const setAnnotationNameAction = (name: string) =>
  ({
    type: "SET_ANNOTATION_NAME",
    name,
  } as const);

export const setAnnotationVisibilityAction = (visibility: APIAnnotationVisibility) =>
  ({
    type: "SET_ANNOTATION_VISIBILITY",
    visibility,
  } as const);

export const editAnnotationLayerAction = (
  tracingId: string,
  layerProperties: EditableLayerProperties,
) =>
  ({
    type: "EDIT_ANNOTATION_LAYER",
    tracingId,
    layerProperties,
  } as const);

export const setAnnotationDescriptionAction = (description: string) =>
  ({
    type: "SET_ANNOTATION_DESCRIPTION",
    description,
  } as const);

export const setAnnotationAllowUpdateAction = (allowUpdate: boolean) =>
  ({
    type: "SET_ANNOTATION_ALLOW_UPDATE",
    allowUpdate,
  } as const);

// Strictly speaking this is no annotation action but a tracing action, as the boundingBox is saved with
// the tracing, hence no ANNOTATION in the action type.
export const setUserBoundingBoxesAction = (userBoundingBoxes: Array<UserBoundingBox>) =>
  ({
    type: "SET_USER_BOUNDING_BOXES",
    userBoundingBoxes,
  } as const);

export const changeUserBoundingBoxAction = (id: number, newProps: UserBoundingBoxWithoutIdMaybe) =>
  ({
    type: "CHANGE_USER_BOUNDING_BOX",
    id,
    newProps,
  } as const);

export const finishedResizingUserBoundingBoxAction = (id: number) =>
  ({
    type: "FINISHED_RESIZING_USER_BOUNDING_BOX",
    id,
  } as const);

export const addUserBoundingBoxAction = (
  newBoundingBox?: UserBoundingBoxWithoutId | null | undefined,
  center?: Vector3,
) =>
  ({
    type: "ADD_NEW_USER_BOUNDING_BOX",
    newBoundingBox,
    center,
  } as const);

export const deleteUserBoundingBoxAction = (id: number) =>
  ({
    type: "DELETE_USER_BOUNDING_BOX",
    id,
  } as const);

export const addUserBoundingBoxesAction = (userBoundingBoxes: Array<UserBoundingBox>) =>
  ({
    type: "ADD_USER_BOUNDING_BOXES",
    userBoundingBoxes,
  } as const);

export const updateRemoteMeshMetaDataAction = (
  id: string,
  meshShape: Partial<RemoteMeshMetaData>,
) =>
  ({
    type: "UPDATE_REMOTE_MESH_METADATA",
    id,
    meshShape,
  } as const);

export const updateLocalMeshMetaDataAction = (id: string, meshShape: Partial<LocalMeshMetaData>) =>
  ({
    type: "UPDATE_LOCAL_MESH_METADATA",
    id,
    meshShape,
  } as const);

export const updateIsosurfaceVisibilityAction = (
  layerName: string,
  id: number,
  visibility: boolean,
) =>
  ({
    type: "UPDATE_ISOSURFACE_VISIBILITY",
    layerName,
    id,
    visibility,
  } as const);

export const addMeshMetaDataAction = (mesh: MeshMetaData) =>
  ({
    type: "ADD_MESH_METADATA",
    mesh,
  } as const);

export const deleteMeshAction = (id: string) =>
  ({
    type: "DELETE_MESH",
    id,
  } as const);

export const createMeshFromBufferAction = (name: string, buffer: ArrayBuffer) =>
  ({
    type: "CREATE_MESH_FROM_BUFFER",
    buffer,
    name,
  } as const);

export const triggerIsosurfaceDownloadAction = (cellName: string, cellId: number) =>
  ({
    type: "TRIGGER_ISOSURFACE_DOWNLOAD",
    cellName,
    cellId,
  } as const);

export const refreshIsosurfacesAction = () =>
  ({
    type: "REFRESH_ISOSURFACES",
  } as const);

export const refreshIsosurfaceAction = (layerName: string, cellId: number) =>
  ({
    type: "REFRESH_ISOSURFACE",
    layerName,
    cellId,
  } as const);

export const startedLoadingIsosurfaceAction = (layerName: string, cellId: number) =>
  ({
    type: "STARTED_LOADING_ISOSURFACE",
    layerName,
    cellId,
  } as const);

export const finishedLoadingIsosurfaceAction = (layerName: string, cellId: number) =>
  ({
    type: "FINISHED_LOADING_ISOSURFACE",
    layerName,
    cellId,
  } as const);

export const updateMeshFileListAction = (layerName: string, meshFiles: Array<APIMeshFile>) =>
  ({
    type: "UPDATE_MESH_FILE_LIST",
    layerName,
    meshFiles,
  } as const);

export const updateCurrentMeshFileAction = (
  layerName: string,
  meshFileName: string | null | undefined,
) =>
  ({
    type: "UPDATE_CURRENT_MESH_FILE",
    layerName,
    meshFileName,
  } as const);

export const importIsosurfaceFromStlAction = (layerName: string, buffer: ArrayBuffer) =>
  ({
    type: "IMPORT_ISOSURFACE_FROM_STL",
    layerName,
    buffer,
  } as const);

export const removeIsosurfaceAction = (layerName: string, cellId: NumberOrBig) =>
  ({
    type: "REMOVE_ISOSURFACE",
    layerName,
    cellId,
  } as const);

export const addAdHocIsosurfaceAction = (
  layerName: string,
  cellId: number,
  seedPosition: Vector3,
  mappingName: string | null | undefined,
  mappingType: MappingType | null | undefined,
) =>
  ({
    type: "ADD_AD_HOC_ISOSURFACE",
    layerName,
    cellId,
    seedPosition,
    mappingName,
    mappingType,
  } as const);

export const addPrecomputedIsosurfaceAction = (
  layerName: string,
  cellId: number,
  seedPosition: Vector3,
  meshFileName: string,
) =>
  ({
    type: "ADD_PRECOMPUTED_ISOSURFACE",
    layerName,
    cellId,
    seedPosition,
    meshFileName,
  } as const);

export const setOthersMayEditForAnnotationAction = (othersMayEdit: boolean) =>
  ({
    type: "SET_OTHERS_MAY_EDIT_FOR_ANNOTATION",
    othersMayEdit,
  } as const);
