import type { APIConnectomeFile } from "types/api_types";
import type { MutableTreeMap } from "viewer/model/types/tree_types";
export type InitializeConnectomeTracingAction = ReturnType<
  typeof initializeConnectomeTracingAction
>;
type RemoveConnectomeTracingAction = ReturnType<typeof removeConnectomeTracingAction>;
type AddConnectomeTreesAction = ReturnType<typeof addConnectomeTreesAction>;
type DeleteConnectomeTreesAction = ReturnType<typeof deleteConnectomeTreesAction>;
type SetConnectomeTreesVisibilityAction = ReturnType<typeof setConnectomeTreesVisibilityAction>;
export type UpdateConnectomeFileListAction = ReturnType<typeof updateConnectomeFileListAction>;
export type UpdateCurrentConnectomeFileAction = ReturnType<
  typeof updateCurrentConnectomeFileAction
>;
type SetActiveConnectomeAgglomerateIdsAction = ReturnType<
  typeof setActiveConnectomeAgglomerateIdsAction
>;
export type LoadConnectomeAgglomerateTreeAction = ReturnType<
  typeof loadConnectomeAgglomerateTreeAction
>;
export type RemoveConnectomeAgglomerateTreeAction = ReturnType<
  typeof removeConnectomeAgglomerateTreeAction
>;
export type ConnectomeAction =
  | InitializeConnectomeTracingAction
  | RemoveConnectomeTracingAction
  | AddConnectomeTreesAction
  | DeleteConnectomeTreesAction
  | SetConnectomeTreesVisibilityAction
  | UpdateConnectomeFileListAction
  | UpdateCurrentConnectomeFileAction
  | SetActiveConnectomeAgglomerateIdsAction
  | LoadConnectomeAgglomerateTreeAction
  | RemoveConnectomeAgglomerateTreeAction;

export const initializeConnectomeTracingAction = (layerName: string) =>
  ({
    type: "INITIALIZE_CONNECTOME_TRACING",
    layerName,
  }) as const;

export const removeConnectomeTracingAction = (layerName: string) =>
  ({
    type: "REMOVE_CONNECTOME_TRACING",
    layerName,
  }) as const;

export const addConnectomeTreesAction = (trees: MutableTreeMap, layerName: string) =>
  ({
    type: "ADD_CONNECTOME_TREES",
    trees,
    layerName,
  }) as const;

export const deleteConnectomeTreesAction = (treeIds: Array<number>, layerName: string) =>
  ({
    type: "DELETE_CONNECTOME_TREES",
    treeIds,
    layerName,
  }) as const;

export const setConnectomeTreesVisibilityAction = (
  treeIds: Array<number>,
  isVisible: boolean,
  layerName: string,
) =>
  ({
    type: "SET_CONNECTOME_TREES_VISIBILITY",
    treeIds,
    isVisible,
    layerName,
  }) as const;

export const updateConnectomeFileListAction = (
  layerName: string,
  connectomeFiles: Array<APIConnectomeFile>,
) =>
  ({
    type: "UPDATE_CONNECTOME_FILE_LIST",
    layerName,
    connectomeFiles,
  }) as const;

export const updateCurrentConnectomeFileAction = (
  layerName: string,
  connectomeFileName: string | null | undefined,
) =>
  ({
    type: "UPDATE_CURRENT_CONNECTOME_FILE",
    layerName,
    connectomeFileName,
  }) as const;

export const setActiveConnectomeAgglomerateIdsAction = (
  layerName: string,
  agglomerateIds: Array<bigint>,
) =>
  ({
    type: "SET_ACTIVE_CONNECTOME_AGGLOMERATE_IDS",
    layerName,
    agglomerateIds,
  }) as const;

export const loadConnectomeAgglomerateTreeAction = (
  layerName: string,
  mappingName: string,
  agglomerateId: bigint,
) =>
  ({
    type: "LOAD_CONNECTOME_AGGLOMERATE_TREE",
    layerName,
    mappingName,
    agglomerateId,
  }) as const;

export const removeConnectomeAgglomerateTreeAction = (
  layerName: string,
  mappingName: string,
  agglomerateId: bigint,
) =>
  ({
    type: "REMOVE_CONNECTOME_AGGLOMERATE_TREE",
    layerName,
    mappingName,
    agglomerateId,
  }) as const;
