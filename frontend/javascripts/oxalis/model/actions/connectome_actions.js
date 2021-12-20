// @flow
import { type MutableTreeMap } from "oxalis/store";
import { type APIConnectomeFile } from "types/api_flow_types";

export type InitializeConnectomeTracingAction = {
  type: "INITIALIZE_CONNECTOME_TRACING",
  layerName: string,
};

type AddConnectomeTreesAction = {
  type: "ADD_CONNECTOME_TREES",
  trees: MutableTreeMap,
  layerName: string,
};

type DeleteConnectomeTreeAction = {
  type: "DELETE_CONNECTOME_TREE",
  treeId: number,
  layerName: string,
};

type SetConnectomeTreeVisibilityAction = {
  type: "SET_CONNECTOME_TREE_VISIBILITY",
  treeId: number,
  isVisible: boolean,
  layerName: string,
};

export type UpdateConnectomeFileListAction = {
  type: "UPDATE_CONNECTOME_FILE_LIST",
  layerName: string,
  connectomeFiles: Array<APIConnectomeFile>,
};
export type UpdateCurrentConnectomeFileAction = {
  type: "UPDATE_CURRENT_CONNECTOME_FILE",
  layerName: string,
  connectomeFileName: ?string,
};

type SetActiveConnectomeAgglomerateIdsAction = {
  type: "SET_ACTIVE_CONNECTOME_AGGLOMERATE_IDS",
  layerName: string,
  agglomerateIds: Array<number>,
};

export type ConnectomeAction =
  | InitializeConnectomeTracingAction
  | AddConnectomeTreesAction
  | DeleteConnectomeTreeAction
  | SetConnectomeTreeVisibilityAction
  | UpdateConnectomeFileListAction
  | UpdateCurrentConnectomeFileAction
  | SetActiveConnectomeAgglomerateIdsAction;

export const initializeConnectomeTracingAction = (
  layerName: string,
): InitializeConnectomeTracingAction => ({
  type: "INITIALIZE_CONNECTOME_TRACING",
  layerName,
});

export const addConnectomeTreesAction = (
  trees: MutableTreeMap,
  layerName: string,
): AddConnectomeTreesAction => ({
  type: "ADD_CONNECTOME_TREES",
  trees,
  layerName,
});

export const deleteConnectomeTreeAction = (
  treeId: number,
  layerName: string,
): DeleteConnectomeTreeAction => ({
  type: "DELETE_CONNECTOME_TREE",
  treeId,
  layerName,
});

export const setConnectomeTreeVisibilityAction = (
  treeId: number,
  isVisible: boolean,
  layerName: string,
): SetConnectomeTreeVisibilityAction => ({
  type: "SET_CONNECTOME_TREE_VISIBILITY",
  treeId,
  isVisible,
  layerName,
});

export const updateConnectomeFileListAction = (
  layerName: string,
  connectomeFiles: Array<APIConnectomeFile>,
): UpdateConnectomeFileListAction => ({
  type: "UPDATE_CONNECTOME_FILE_LIST",
  layerName,
  connectomeFiles,
});

export const updateCurrentConnectomeFileAction = (
  layerName: string,
  connectomeFileName: ?string,
): UpdateCurrentConnectomeFileAction => ({
  type: "UPDATE_CURRENT_CONNECTOME_FILE",
  layerName,
  connectomeFileName,
});

export const setActiveConnectomeAgglomerateIdsAction = (
  layerName: string,
  agglomerateIds: Array<number>,
): SetActiveConnectomeAgglomerateIdsAction => ({
  type: "SET_ACTIVE_CONNECTOME_AGGLOMERATE_IDS",
  layerName,
  agglomerateIds,
});
