// @flow
import { type MutableTreeMap } from "oxalis/store";

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

export type ConnectomeAction =
  | InitializeConnectomeTracingAction
  | AddConnectomeTreesAction
  | DeleteConnectomeTreeAction;

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
