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

type DeleteConnectomeTreesAction = {
  type: "DELETE_CONNECTOME_TREES",
  treeIds: Array<number>,
  layerName: string,
};

type SetConnectomeTreesVisibilityAction = {
  type: "SET_CONNECTOME_TREES_VISIBILITY",
  treeIds: Array<number>,
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
  | DeleteConnectomeTreesAction
  | SetConnectomeTreesVisibilityAction
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

export const deleteConnectomeTreesAction = (
  treeIds: Array<number>,
  layerName: string,
): DeleteConnectomeTreesAction => ({
  type: "DELETE_CONNECTOME_TREES",
  treeIds,
  layerName,
});

export const setConnectomeTreesVisibilityAction = (
  treeIds: Array<number>,
  isVisible: boolean,
  layerName: string,
): SetConnectomeTreesVisibilityAction => ({
  type: "SET_CONNECTOME_TREES_VISIBILITY",
  treeIds,
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
