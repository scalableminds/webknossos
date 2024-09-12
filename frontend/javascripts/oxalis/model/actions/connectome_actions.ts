import type { MutableTreeMap } from "oxalis/store";
import type { APIConnectomeFile } from "types/api_flow_types";
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
export type LoadConnectomeAgglomerateSkeletonAction = ReturnType<
  typeof loadConnectomeAgglomerateSkeletonAction
>;
export type RemoveConnectomeAgglomerateSkeletonAction = ReturnType<
  typeof removeConnectomeAgglomerateSkeletonAction
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
  | LoadConnectomeAgglomerateSkeletonAction
  | RemoveConnectomeAgglomerateSkeletonAction;

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
  agglomerateIds: Array<number>,
) =>
  ({
    type: "SET_ACTIVE_CONNECTOME_AGGLOMERATE_IDS",
    layerName,
    agglomerateIds,
  }) as const;

export const loadConnectomeAgglomerateSkeletonAction = (
  layerName: string,
  mappingName: string,
  agglomerateId: number,
) =>
  ({
    type: "LOAD_CONNECTOME_AGGLOMERATE_SKELETON",
    layerName,
    mappingName,
    agglomerateId,
  }) as const;

export const removeConnectomeAgglomerateSkeletonAction = (
  layerName: string,
  mappingName: string,
  agglomerateId: number,
) =>
  ({
    type: "REMOVE_CONNECTOME_AGGLOMERATE_SKELETON",
    layerName,
    mappingName,
    agglomerateId,
  }) as const;
