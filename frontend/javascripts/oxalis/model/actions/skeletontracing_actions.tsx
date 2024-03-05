import { Modal } from "antd";
import React from "react";
import type { ServerSkeletonTracing } from "types/api_flow_types";
import type { Vector3, TreeType } from "oxalis/constants";
import {
  enforceSkeletonTracing,
  getNodeAndTree,
  getTree,
} from "oxalis/model/accessors/skeletontracing_accessor";
import RemoveTreeModal from "oxalis/view/remove_tree_modal";
import type { OxalisState, SkeletonTracing, TreeGroup, MutableTreeMap } from "oxalis/store";
import Store from "oxalis/store";
import messages from "messages";
import renderIndependently from "libs/render_independently";
import { AllUserBoundingBoxActions } from "oxalis/model/actions/annotation_actions";
import { batchActions } from "redux-batched-actions";
import { type AdditionalCoordinate } from "types/api_flow_types";

export type InitializeSkeletonTracingAction = ReturnType<typeof initializeSkeletonTracingAction>;
export type CreateNodeAction = ReturnType<typeof createNodeAction>;
export type DeleteNodeAction = ReturnType<typeof deleteNodeAction>;
export type DeleteEdgeAction = ReturnType<typeof deleteEdgeAction>;
type SetActiveNodeAction = ReturnType<typeof setActiveNodeAction>;
type CenterActiveNodeAction = ReturnType<typeof centerActiveNodeAction>;
type SetNodeRadiusAction = ReturnType<typeof setNodeRadiusAction>;
export type SetNodePositionAction = ReturnType<typeof setNodePositionAction>;
type CreateBranchPointAction = ReturnType<typeof createBranchPointAction>;
type DeleteBranchPointAction = ReturnType<typeof deleteBranchPointAction>;
type DeleteBranchpointByIdAction = ReturnType<typeof deleteBranchpointByIdAction>;
type ToggleTreeAction = ReturnType<typeof toggleTreeAction>;
type SetTreeVisibilityAction = ReturnType<typeof setTreeVisibilityAction>;
type ToggleAllTreesAction = ReturnType<typeof toggleAllTreesAction>;
type ToggleInactiveTreesAction = ReturnType<typeof toggleInactiveTreesAction>;
type ToggleTreeGroupAction = ReturnType<typeof toggleTreeGroupAction>;
type RequestDeleteBranchPointAction = ReturnType<typeof requestDeleteBranchPointAction>;
type CreateTreeAction = ReturnType<typeof createTreeAction>;
type SetEdgeVisibilityAction = ReturnType<typeof setTreeEdgeVisibilityAction>;
type AddTreesAndGroupsAction = ReturnType<typeof addTreesAndGroupsAction>;
type DeleteTreeAction = ReturnType<typeof deleteTreeAction>;
type ResetSkeletonTracingAction = ReturnType<typeof resetSkeletonTracingAction>;
type SetActiveTreeAction = ReturnType<typeof setActiveTreeAction>;
type SetActiveTreeByNameAction = ReturnType<typeof setActiveTreeByNameAction>;
type DeselectActiveTreeAction = ReturnType<typeof deselectActiveTreeAction>;
type SetActiveTreeGroupAction = ReturnType<typeof setActiveTreeGroupAction>;
type DeselectActiveTreeGroupAction = ReturnType<typeof deselectActiveTreeGroupAction>;
export type MergeTreesAction = ReturnType<typeof mergeTreesAction>;
type SetTreeNameAction = ReturnType<typeof setTreeNameAction>;
type SelectNextTreeAction = ReturnType<typeof selectNextTreeAction>;
type SetTreeColorIndexAction = ReturnType<typeof setTreeColorIndexAction>;
type ShuffleTreeColorAction = ReturnType<typeof shuffleTreeColorAction>;
type SetTreeColorAction = ReturnType<typeof setTreeColorAction>;
type ShuffleAllTreeColorsAction = ReturnType<typeof shuffleAllTreeColorsAction>;
type SetTreeTypeAction = ReturnType<typeof setTreeTypeAction>;
type CreateCommentAction = ReturnType<typeof createCommentAction>;
type DeleteCommentAction = ReturnType<typeof deleteCommentAction>;
type SetTracingAction = ReturnType<typeof setTracingAction>;
type SetTreeGroupsAction = ReturnType<typeof setTreeGroupsAction>;
type SetTreeGroupAction = ReturnType<typeof setTreeGroupAction>;
type SetShowSkeletonsAction = ReturnType<typeof setShowSkeletonsAction>;
type SetMergerModeEnabledAction = ReturnType<typeof setMergerModeEnabledAction>;
type UpdateNavigationListAction = ReturnType<typeof updateNavigationListAction>;
export type LoadAgglomerateSkeletonAction = ReturnType<typeof loadAgglomerateSkeletonAction>;
type NoAction = ReturnType<typeof noAction>;

export type BatchableUpdateTreeAction = SetTreeGroupAction | DeleteTreeAction | SetTreeGroupsAction;
export type BatchUpdateGroupsAndTreesAction = {
  type: "BATCH_UPDATE_GROUPS_AND_TREES";
  payload: BatchableUpdateTreeAction[];
  meta: {
    batch: true;
  };
};

export type SkeletonTracingAction =
  | InitializeSkeletonTracingAction
  | CreateNodeAction
  | DeleteNodeAction
  | DeleteEdgeAction
  | SetActiveNodeAction
  | CenterActiveNodeAction
  | SetActiveTreeGroupAction
  | DeselectActiveTreeGroupAction
  | SetNodeRadiusAction
  | SetNodePositionAction
  | CreateBranchPointAction
  | DeleteBranchPointAction
  | DeleteBranchpointByIdAction
  | RequestDeleteBranchPointAction
  | CreateTreeAction
  | SetEdgeVisibilityAction
  | AddTreesAndGroupsAction
  | DeleteTreeAction
  | ResetSkeletonTracingAction
  | SetActiveTreeAction
  | SetActiveTreeByNameAction
  | DeselectActiveTreeAction
  | MergeTreesAction
  | SetTreeNameAction
  | SelectNextTreeAction
  | SetTreeColorAction
  | SetTreeTypeAction
  | ShuffleTreeColorAction
  | ShuffleAllTreeColorsAction
  | SetTreeColorIndexAction
  | CreateCommentAction
  | DeleteCommentAction
  | ToggleTreeAction
  | ToggleAllTreesAction
  | SetTreeVisibilityAction
  | ToggleInactiveTreesAction
  | ToggleTreeGroupAction
  | NoAction
  | SetTracingAction
  | SetTreeGroupsAction
  | SetTreeGroupAction
  | SetShowSkeletonsAction
  | SetMergerModeEnabledAction
  | UpdateNavigationListAction
  | LoadAgglomerateSkeletonAction;

export const SkeletonTracingSaveRelevantActions = [
  "INITIALIZE_SKELETONTRACING",
  "CREATE_NODE",
  "DELETE_NODE",
  "DELETE_EDGE",
  "SET_ACTIVE_NODE",
  "SET_NODE_RADIUS",
  "SET_NODE_POSITION",
  "CREATE_BRANCHPOINT",
  "DELETE_BRANCHPOINT_BY_ID",
  "DELETE_BRANCHPOINT",
  "CREATE_TREE",
  "SET_EDGES_ARE_VISIBLE",
  "ADD_TREES_AND_GROUPS",
  "DELETE_TREE",
  "SET_ACTIVE_TREE",
  "SET_ACTIVE_TREE_BY_NAME",
  "SET_TREE_NAME",
  "MERGE_TREES",
  "SELECT_NEXT_TREE",
  "SHUFFLE_TREE_COLOR",
  "SHUFFLE_ALL_TREE_COLORS",
  "SET_TREE_TYPE",
  "CREATE_COMMENT",
  "DELETE_COMMENT",
  "SET_TREE_GROUPS",
  "SET_TREE_GROUP",
  "SET_MERGER_MODE_ENABLED",
  "TOGGLE_TREE",
  "TOGGLE_TREE_GROUP",
  "TOGGLE_ALL_TREES",
  "TOGGLE_INACTIVE_TREES",
  "SET_TREE_COLOR",
  "BATCH_UPDATE_GROUPS_AND_TREES", // Composited actions, only dispatched using `batchActions`
  ...AllUserBoundingBoxActions,
];

const noAction = () =>
  ({
    type: "NONE",
  }) as const;

export const initializeSkeletonTracingAction = (tracing: ServerSkeletonTracing) =>
  ({
    type: "INITIALIZE_SKELETONTRACING",
    tracing,
  }) as const;

export const createNodeAction = (
  position: Vector3,
  additionalCoordinates: AdditionalCoordinate[] | null,
  rotation: Vector3,
  viewport: number,
  resolution: number,
  treeId?: number | null | undefined,
  dontActivate: boolean = false,
  timestamp: number = Date.now(),
) =>
  ({
    type: "CREATE_NODE",
    position,
    additionalCoordinates,
    rotation,
    viewport,
    resolution,
    treeId,
    dontActivate,
    timestamp,
  }) as const;

export const deleteNodeAction = (
  nodeId?: number,
  treeId?: number,
  timestamp: number = Date.now(),
) =>
  ({
    type: "DELETE_NODE",
    nodeId,
    treeId,
    timestamp,
  }) as const;

export const deleteEdgeAction = (
  sourceNodeId: number,
  targetNodeId: number,
  timestamp: number = Date.now(),
) =>
  ({
    type: "DELETE_EDGE",
    sourceNodeId,
    targetNodeId,
    timestamp,
  }) as const;

export const setActiveNodeAction = (
  nodeId: number,
  suppressAnimation: boolean = false,
  suppressCentering: boolean = false,
) =>
  ({
    type: "SET_ACTIVE_NODE",
    nodeId,
    suppressAnimation,
    suppressCentering,
  }) as const;

export const centerActiveNodeAction = (suppressAnimation: boolean = false) =>
  ({
    type: "CENTER_ACTIVE_NODE",
    suppressAnimation,
  }) as const;

export const setNodeRadiusAction = (radius: number, nodeId?: number, treeId?: number) =>
  ({
    type: "SET_NODE_RADIUS",
    radius,
    nodeId,
    treeId,
  }) as const;

export const setNodePositionAction = (position: Vector3, nodeId?: number, treeId?: number) =>
  ({
    type: "SET_NODE_POSITION",
    position,
    nodeId,
    treeId,
  }) as const;

export const createBranchPointAction = (
  nodeId?: number,
  treeId?: number,
  timestamp: number = Date.now(),
) =>
  ({
    type: "CREATE_BRANCHPOINT",
    nodeId,
    treeId,
    timestamp,
  }) as const;

export const deleteBranchPointAction = () =>
  ({
    type: "DELETE_BRANCHPOINT",
  }) as const;

export const deleteBranchpointByIdAction = (nodeId: number, treeId: number) =>
  ({
    type: "DELETE_BRANCHPOINT_BY_ID",
    nodeId,
    treeId,
  }) as const;

export const requestDeleteBranchPointAction = () =>
  ({
    type: "REQUEST_DELETE_BRANCHPOINT",
  }) as const;

export const createTreeAction = (timestamp: number = Date.now()) =>
  ({
    type: "CREATE_TREE",
    timestamp,
  }) as const;

export const setTreeEdgeVisibilityAction = (
  treeId: number | null | undefined,
  edgesAreVisible: boolean,
) =>
  ({
    type: "SET_EDGES_ARE_VISIBLE",
    treeId,
    edgesAreVisible,
  }) as const;

export const addTreesAndGroupsAction = (
  trees: MutableTreeMap,
  treeGroups: Array<TreeGroup> | null | undefined,
  treeIdsCallback: ((ids: number[]) => void) | undefined = undefined,
) =>
  ({
    type: "ADD_TREES_AND_GROUPS",
    trees,
    treeGroups: treeGroups || [],
    treeIdsCallback,
  }) as const;

export const deleteTreeAction = (treeId?: number, suppressActivatingNextNode: boolean = false) =>
  // If suppressActivatingNextNode is true, the tree will be deleted without activating
  // another node (nor tree). Use this in cases where you want to avoid changing
  // the active position (due to the auto-centering). One could also suppress the auto-centering
  // behavior, but the semantics of changing the active node might also be confusing to the user
  // (e.g., when proofreading). So, it might be clearer to not have an active node in the first
  // place.
  ({
    type: "DELETE_TREE",
    treeId,
    suppressActivatingNextNode,
  }) as const;

export const resetSkeletonTracingAction = () =>
  ({
    type: "RESET_SKELETON_TRACING",
  }) as const;

export const toggleTreeAction = (
  treeId: number | null | undefined,
  timestamp: number = Date.now(),
) =>
  ({
    type: "TOGGLE_TREE",
    treeId,
    timestamp,
  }) as const;

export const setTreeVisibilityAction = (treeId: number | null | undefined, isVisible: boolean) =>
  ({
    type: "SET_TREE_VISIBILITY",
    treeId,
    isVisible,
  }) as const;

export const toggleAllTreesAction = (timestamp: number = Date.now()) =>
  ({
    type: "TOGGLE_ALL_TREES",
    timestamp,
  }) as const;

export const toggleInactiveTreesAction = (timestamp: number = Date.now()) =>
  ({
    type: "TOGGLE_INACTIVE_TREES",
    timestamp,
  }) as const;

export const toggleTreeGroupAction = (groupId: number) =>
  ({
    type: "TOGGLE_TREE_GROUP",
    groupId,
  }) as const;

export const setActiveTreeAction = (treeId: number) =>
  ({
    type: "SET_ACTIVE_TREE",
    treeId,
  }) as const;

export const setActiveTreeByNameAction = (treeName: string) =>
  ({
    type: "SET_ACTIVE_TREE_BY_NAME",
    treeName,
  }) as const;

export const deselectActiveTreeAction = () =>
  ({
    type: "DESELECT_ACTIVE_TREE",
  }) as const;

export const setActiveTreeGroupAction = (groupId: number) =>
  ({
    type: "SET_TREE_ACTIVE_GROUP",
    groupId,
  }) as const;

export const deselectActiveTreeGroupAction = () =>
  ({
    type: "DESELECT_ACTIVE_TREE_GROUP",
  }) as const;

export const mergeTreesAction = (sourceNodeId: number, targetNodeId: number) =>
  ({
    type: "MERGE_TREES",
    sourceNodeId,
    targetNodeId,
  }) as const;

export const setTreeNameAction = (
  name: string | undefined | null = null,
  treeId?: number | null | undefined,
) =>
  ({
    type: "SET_TREE_NAME",
    name,
    treeId,
  }) as const;

export const selectNextTreeAction = (forward: boolean | null | undefined = true) =>
  ({
    type: "SELECT_NEXT_TREE",
    forward,
  }) as const;

export const setTreeColorIndexAction = (treeId: number | null | undefined, colorIndex: number) =>
  ({
    type: "SET_TREE_COLOR_INDEX",
    treeId,
    colorIndex,
  }) as const;

export const shuffleTreeColorAction = (treeId: number) =>
  ({
    type: "SHUFFLE_TREE_COLOR",
    treeId,
  }) as const;

export const setTreeColorAction = (treeId: number, color: Vector3) =>
  ({
    type: "SET_TREE_COLOR",
    treeId,
    color,
  }) as const;

export const shuffleAllTreeColorsAction = () =>
  ({
    type: "SHUFFLE_ALL_TREE_COLORS",
  }) as const;

export const setTreeTypeAction = (treeId: number, treeType: TreeType) =>
  ({
    type: "SET_TREE_TYPE",
    treeId,
    treeType,
  }) as const;

export const createCommentAction = (commentText: string, nodeId?: number, treeId?: number) =>
  ({
    type: "CREATE_COMMENT",
    commentText,
    nodeId,
    treeId,
  }) as const;

export const deleteCommentAction = (nodeId?: number, treeId?: number) =>
  ({
    type: "DELETE_COMMENT",
    nodeId,
    treeId,
  }) as const;

export const setTracingAction = (tracing: SkeletonTracing) =>
  ({
    type: "SET_TRACING",
    tracing,
  }) as const;

export const setTreeGroupsAction = (treeGroups: Array<TreeGroup>) =>
  ({
    type: "SET_TREE_GROUPS",
    treeGroups,
  }) as const;

export const setTreeGroupAction = (groupId: number | null | undefined, treeId?: number) =>
  ({
    type: "SET_TREE_GROUP",
    groupId,
    treeId,
  }) as const;

export const setShowSkeletonsAction = (showSkeletons: boolean) =>
  ({
    type: "SET_SHOW_SKELETONS",
    showSkeletons,
  }) as const;

export const setMergerModeEnabledAction = (active: boolean) =>
  ({
    type: "SET_MERGER_MODE_ENABLED",
    active,
  }) as const;

// The following actions have the prefix "AsUser" which means that they
// offer some additional logic which is sensible from a user-centered point of view.
// For example, the deleteNodeAsUserAction also initiates the deletion of a tree,
// when the current tree is empty.
export const deleteNodeAsUserAction = (
  state: OxalisState,
  nodeId?: number,
  treeId?: number,
): DeleteNodeAction | NoAction | DeleteTreeAction => {
  const skeletonTracing = enforceSkeletonTracing(state.tracing);
  return getNodeAndTree(skeletonTracing, nodeId, treeId)
    .map(([tree, node]): DeleteNodeAction | NoAction | DeleteTreeAction => {
      if (state.task != null && node.id === 1) {
        // Let the user confirm the deletion of the initial node (node with id 1) of a task
        Modal.confirm({
          title: messages["tracing.delete_initial_node"],
          onOk: () => {
            Store.dispatch(deleteNodeAction(node.id, tree.treeId));
          },
        });
        // As Modal.confirm is async, return noAction() and the modal will dispatch the real action
        // if the user confirms
        return noAction();
      }

      return deleteNodeAction(node.id, tree.treeId);
    }) // If the tree is empty, it will be deleted
    .getOrElse(deleteTreeAction(treeId));
};

// Let the user confirm the deletion of the initial node (node with id 1) of a task
function confirmDeletingInitialNode(treeId?: number) {
  Modal.confirm({
    title: messages["tracing.delete_tree_with_initial_node"],
    onOk: () => {
      Store.dispatch(deleteTreeAction(treeId));
    },
  });
}

export const deleteTreeAsUserAction = (treeId?: number): NoAction => {
  const state = Store.getState();
  const skeletonTracing = enforceSkeletonTracing(state.tracing);
  getTree(skeletonTracing, treeId).map((tree) => {
    if (state.task != null && tree.nodes.has(1)) {
      confirmDeletingInitialNode(treeId);
    } else if (state.userConfiguration.hideTreeRemovalWarning) {
      Store.dispatch(deleteTreeAction(treeId));
    } else {
      renderIndependently((destroy) => (
        <RemoveTreeModal onOk={() => Store.dispatch(deleteTreeAction(treeId))} destroy={destroy} />
      ));
    }
  });
  // As Modal.confirm is async, return noAction() and the modal will dispatch the real action
  // if the user confirms
  return noAction();
};
export const updateNavigationListAction = (list: Array<number>, activeIndex: number) =>
  ({
    type: "UPDATE_NAVIGATION_LIST",
    list,
    activeIndex,
  }) as const;

export const loadAgglomerateSkeletonAction = (
  layerName: string,
  mappingName: string,
  agglomerateId: number,
) =>
  ({
    type: "LOAD_AGGLOMERATE_SKELETON",
    layerName,
    mappingName,
    agglomerateId,
  }) as const;

export const batchUpdateGroupsAndTreesAction = (actions: BatchableUpdateTreeAction[]) =>
  batchActions(
    actions,
    "BATCH_UPDATE_GROUPS_AND_TREES",
  ) as unknown as BatchUpdateGroupsAndTreesAction;
