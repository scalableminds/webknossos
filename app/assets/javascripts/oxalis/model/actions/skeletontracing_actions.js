/* eslint-disable import/prefer-default-export */

/**
 * skeletontracing_actions.js
 * @flow
 */
import Store from "oxalis/store";
import { getActiveNode, getTree } from "oxalis/model/accessors/skeletontracing_accessor";
import messages from "messages";
import { Modal } from "antd";
import type { Vector3 } from "oxalis/constants";
import type { APIAnnotationType, ServerSkeletonTracingType } from "admin/api_flow_types";
import type { SkeletonTracingType, TreeMapType, TreeGroupType } from "oxalis/store";

type InitializeSkeletonTracingActionType = {
  type: "INITIALIZE_SKELETONTRACING",
  annotation: APIAnnotationType,
  tracing: ServerSkeletonTracingType,
};
type CreateNodeActionType = {
  type: "CREATE_NODE",
  position: Vector3,
  rotation: Vector3,
  viewport: number,
  resolution: number,
  timestamp: number,
  treeId?: number,
};
type DeleteNodeActionType = {
  type: "DELETE_NODE",
  nodeId?: number,
  treeId?: number,
  timestamp: number,
};
type DeleteEdgeActionType = {
  type: "DELETE_EDGE",
  sourceNodeId: number,
  targetNodeId: number,
  timestamp: number,
};
type SetActiveNodeActionType = { type: "SET_ACTIVE_NODE", nodeId: number };
type SetNodeRadiusActionType = {
  type: "SET_NODE_RADIUS",
  radius: number,
  nodeId: ?number,
  treeId: ?number,
};
type CreateBranchPointActionType = {
  type: "CREATE_BRANCHPOINT",
  nodeId?: number,
  treeId?: number,
  timestamp: number,
};
type DeleteBranchPointActionType = { type: "DELETE_BRANCHPOINT" };
type ToggleTreeActionType = { type: "TOGGLE_TREE", treeId?: number, timestamp: number };
type ToggleAllTreesActionType = { type: "TOGGLE_ALL_TREES", timestamp: number };
type ToggleInactiveTreesActionType = { type: "TOGGLE_INACTIVE_TREES", timestamp: number };
type ToggleTreeGroupActionType = { type: "TOGGLE_TREE_GROUP", groupId: string };
type RequestDeleteBranchPointActionType = { type: "REQUEST_DELETE_BRANCHPOINT" };
type CreateTreeActionType = { type: "CREATE_TREE", timestamp: number };
type AddTreesAndGroupsActionType = {
  type: "ADD_TREES_AND_GROUPS",
  trees: TreeMapType,
  treeGroups: Array<TreeGroupType>,
};
type DeleteTreeActionType = { type: "DELETE_TREE", treeId?: number, timestamp: number };
type SetActiveTreeActionType = { type: "SET_ACTIVE_TREE", treeId: number };
type MergeTreesActionType = { type: "MERGE_TREES", sourceNodeId: number, targetNodeId: number };
type SetTreeNameActionType = { type: "SET_TREE_NAME", name: ?string, treeId: ?number };
type SelectNextTreeActionType = { type: "SELECT_NEXT_TREE", forward: ?boolean };
type ShuffleTreeColorActionType = { type: "SHUFFLE_TREE_COLOR", treeId?: number };
type ShuffleAllTreeColorsActionType = { type: "SHUFFLE_ALL_TREE_COLORS", treeId?: number };
type CreateCommentActionType = {
  type: "CREATE_COMMENT",
  commentText: string,
  nodeId: ?number,
  treeId: ?number,
};
type DeleteCommentActionType = { type: "DELETE_COMMENT", nodeId: ?number, treeId?: number };
type SetTracingActionType = { type: "SET_TRACING", tracing: SkeletonTracingType };
type SetTreeGroupsActionType = { type: "SET_TREE_GROUPS", treeGroups: Array<TreeGroupType> };
type SetTreeGroupActionType = { type: "SET_TREE_GROUP", groupId: ?string, treeId: number };
type NoActionType = { type: "NONE" };

export type SkeletonTracingActionType =
  | InitializeSkeletonTracingActionType
  | CreateNodeActionType
  | DeleteNodeActionType
  | DeleteEdgeActionType
  | SetActiveNodeActionType
  | SetNodeRadiusActionType
  | CreateBranchPointActionType
  | DeleteBranchPointActionType
  | RequestDeleteBranchPointActionType
  | CreateTreeActionType
  | AddTreesAndGroupsActionType
  | DeleteTreeActionType
  | SetActiveTreeActionType
  | MergeTreesActionType
  | SetTreeNameActionType
  | SetTreeNameActionType
  | SelectNextTreeActionType
  | ShuffleTreeColorActionType
  | ShuffleAllTreeColorsActionType
  | CreateCommentActionType
  | DeleteCommentActionType
  | ToggleTreeActionType
  | ToggleAllTreesActionType
  | ToggleInactiveTreesActionType
  | ToggleTreeGroupActionType
  | NoActionType
  | SetTracingActionType
  | SetTreeGroupsActionType
  | SetTreeGroupActionType;

export const SkeletonTracingSaveRelevantActions = [
  "INITIALIZE_SKELETONTRACING",
  "CREATE_NODE",
  "DELETE_NODE",
  "DELETE_EDGE",
  "SET_ACTIVE_NODE",
  "SET_NODE_RADIUS",
  "CREATE_BRANCHPOINT",
  "DELETE_BRANCHPOINT",
  "CREATE_TREE",
  "ADD_TREES_AND_GROUPS",
  "DELETE_TREE",
  "SET_ACTIVE_TREE",
  "SET_TREE_NAME",
  "MERGE_TREES",
  "SELECT_NEXT_TREE",
  "SHUFFLE_TREE_COLOR",
  "SHUFFLE_ALL_TREE_COLORS",
  "CREATE_COMMENT",
  "DELETE_COMMENT",
  "SET_USER_BOUNDING_BOX",
  "SET_TREE_GROUPS",
  "SET_TREE_GROUP",
];

const noAction = (): NoActionType => ({
  type: "NONE",
});

export const initializeSkeletonTracingAction = (
  annotation: APIAnnotationType,
  tracing: ServerSkeletonTracingType,
): InitializeSkeletonTracingActionType => ({
  type: "INITIALIZE_SKELETONTRACING",
  annotation,
  tracing,
});

export const createNodeAction = (
  position: Vector3,
  rotation: Vector3,
  viewport: number,
  resolution: number,
  treeId?: number,
  timestamp: number = Date.now(),
): CreateNodeActionType => ({
  type: "CREATE_NODE",
  position,
  rotation,
  viewport,
  resolution,
  treeId,
  timestamp,
});

export const deleteNodeAction = (
  nodeId?: number,
  treeId?: number,
  timestamp: number = Date.now(),
): DeleteNodeActionType => ({
  type: "DELETE_NODE",
  nodeId,
  treeId,
  timestamp,
});

export const deleteNodeWithConfirmAction = (
  nodeId?: number,
  treeId?: number,
): DeleteNodeActionType | NoActionType => {
  const state = Store.getState();
  return getActiveNode(state.tracing)
    .map(activeNode => {
      nodeId = nodeId != null ? nodeId : activeNode.id;
      if (state.task != null && nodeId === 1) {
        // Let the user confirm the deletion of the initial node (node with id 1) of a task
        Modal.confirm({
          title: messages["tracing.delete_initial_node"],
          onOk: () => {
            Store.dispatch(deleteNodeAction(nodeId, treeId));
          },
        });
        // As Modal.confirm is async, return noAction() and the modal will dispatch the real action
        // if the user confirms
        return noAction();
      }
      return deleteNodeAction(nodeId, treeId);
    })
    .getOrElse(noAction());
};

export const deleteEdgeAction = (
  sourceNodeId: number,
  targetNodeId: number,
  timestamp: number = Date.now(),
): DeleteEdgeActionType => ({
  type: "DELETE_EDGE",
  sourceNodeId,
  targetNodeId,
  timestamp,
});

export const setActiveNodeAction = (nodeId: number): SetActiveNodeActionType => ({
  type: "SET_ACTIVE_NODE",
  nodeId,
});

export const setNodeRadiusAction = (
  radius: number,
  nodeId?: number,
  treeId?: number,
): SetNodeRadiusActionType => ({
  type: "SET_NODE_RADIUS",
  radius,
  nodeId,
  treeId,
});

export const createBranchPointAction = (
  nodeId?: number,
  treeId?: number,
  timestamp: number = Date.now(),
): CreateBranchPointActionType => ({
  type: "CREATE_BRANCHPOINT",
  nodeId,
  treeId,
  timestamp,
});

export const deleteBranchPointAction = (): DeleteBranchPointActionType => ({
  type: "DELETE_BRANCHPOINT",
});

export const requestDeleteBranchPointAction = (): RequestDeleteBranchPointActionType => ({
  type: "REQUEST_DELETE_BRANCHPOINT",
});

export const createTreeAction = (timestamp: number = Date.now()): CreateTreeActionType => ({
  type: "CREATE_TREE",
  timestamp,
});

export const addTreesAndGroupsAction = (
  trees: TreeMapType,
  treeGroups: Array<TreeGroupType>,
): AddTreesAndGroupsActionType => ({
  type: "ADD_TREES_AND_GROUPS",
  trees,
  treeGroups,
});

export const deleteTreeAction = (
  treeId?: number,
  timestamp: number = Date.now(),
): DeleteTreeActionType => ({
  type: "DELETE_TREE",
  treeId,
  timestamp,
});

export const deleteTreeWithConfirmAction = (treeId?: number): NoActionType => {
  const state = Store.getState();
  getTree(state.tracing, treeId).map(tree => {
    if (state.task != null && tree.nodes.has(1)) {
      // Let the user confirm the deletion of the initial node (node with id 1) of a task
      Modal.confirm({
        title: messages["tracing.delete_tree_with_initial_node"],
        onOk: () => {
          Store.dispatch(deleteTreeAction(treeId));
        },
      });
    } else {
      Modal.confirm({
        title: messages["tracing.delete_tree"],
        onOk: () => {
          Store.dispatch(deleteTreeAction(treeId));
        },
      });
    }
  });
  // As Modal.confirm is async, return noAction() and the modal will dispatch the real action
  // if the user confirms
  return noAction();
};

export const toggleTreeAction = (
  treeId?: number,
  timestamp: number = Date.now(),
): ToggleTreeActionType => ({
  type: "TOGGLE_TREE",
  treeId,
  timestamp,
});

export const toggleAllTreesAction = (timestamp: number = Date.now()): ToggleAllTreesActionType => ({
  type: "TOGGLE_ALL_TREES",
  timestamp,
});

export const toggleInactiveTreesAction = (
  timestamp: number = Date.now(),
): ToggleInactiveTreesActionType => ({
  type: "TOGGLE_INACTIVE_TREES",
  timestamp,
});

export const toggleTreeGroupAction = (groupId: string): ToggleTreeGroupActionType => ({
  type: "TOGGLE_TREE_GROUP",
  groupId,
});

export const setActiveTreeAction = (treeId: number): SetActiveTreeActionType => ({
  type: "SET_ACTIVE_TREE",
  treeId,
});

export const mergeTreesAction = (
  sourceNodeId: number,
  targetNodeId: number,
): MergeTreesActionType => ({
  type: "MERGE_TREES",
  sourceNodeId,
  targetNodeId,
});

export const setTreeNameAction = (
  name: ?string = null,
  treeId: ?number,
): SetTreeNameActionType => ({
  type: "SET_TREE_NAME",
  name,
  treeId,
});

export const selectNextTreeAction = (forward: ?boolean = true): SelectNextTreeActionType => ({
  type: "SELECT_NEXT_TREE",
  forward,
});

export const shuffleTreeColorAction = (treeId: number): ShuffleTreeColorActionType => ({
  type: "SHUFFLE_TREE_COLOR",
  treeId,
});

export const shuffleAllTreeColorsAction = (): ShuffleAllTreeColorsActionType => ({
  type: "SHUFFLE_ALL_TREE_COLORS",
});

export const createCommentAction = (
  commentText: string,
  nodeId?: number,
  treeId?: number,
): CreateCommentActionType => ({
  type: "CREATE_COMMENT",
  commentText,
  nodeId,
  treeId,
});

export const deleteCommentAction = (nodeId?: number, treeId?: number): DeleteCommentActionType => ({
  type: "DELETE_COMMENT",
  nodeId,
  treeId,
});

export const setTracingAction = (tracing: SkeletonTracingType): SetTracingActionType => ({
  type: "SET_TRACING",
  tracing,
});

export const setTreeGroupsAction = (treeGroups: Array<TreeGroupType>): SetTreeGroupsActionType => ({
  type: "SET_TREE_GROUPS",
  treeGroups,
});

export const setTreeGroupAction = (groupId: ?string, treeId: number): SetTreeGroupActionType => ({
  type: "SET_TREE_GROUP",
  groupId,
  treeId,
});
