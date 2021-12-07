// @flow
import { type MutableTreeMap } from "oxalis/store";

export type InitializeConnectomeTracingAction = {
  type: "INITIALIZE_CONNECTOME_TRACING",
  layerName: string,
};

type AddConnectomeTreeAction = {
  type: "ADD_CONNECTOME_TREE",
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
  | AddConnectomeTreeAction
  | DeleteConnectomeTreeAction;

export const initializeConnectomeTracingAction = (
  layerName: string,
): InitializeConnectomeTracingAction => ({
  type: "INITIALIZE_CONNECTOME_TRACING",
  layerName,
});

export const addConnectomeTreeAction = (
  trees: MutableTreeMap,
  layerName: string,
): AddConnectomeTreeAction => ({
  type: "ADD_CONNECTOME_TREE",
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
