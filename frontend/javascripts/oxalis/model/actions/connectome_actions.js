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

export type ConnectomeAction = InitializeConnectomeTracingAction | AddConnectomeTreeAction;

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
