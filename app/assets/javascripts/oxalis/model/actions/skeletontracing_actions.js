/* eslint-disable import/prefer-default-export */

/**
 * skeletontracing_actions.js
 * @flow
 */
import type { Vector3 } from "oxalis/constants";
import type { Tracing } from "oxalis/model";
import type { SkeletonContentDataType } from "oxalis/store";

type initializeSkeletonTracingActionType = {type: "INITIALIZE_SKELETONTRACING", tracing: Tracing<SkeletonContentDataType> };
type createNodeActionType = {type: "CREATE_NODE", position: Vector3, rotation: Vector3, viewport: number, resolution: number, treeId?: number};
type deleteNodeActionType = {type: "DELETE_NODE", nodeId?: number, treeId?: number};
type setActiveNodeActionType = {type: "SET_ACTIVE_NODE", nodeId: number, treeId?: number};
type setActiveNodeRadiusActionType = {type: "SET_ACTIVE_NODE_RADIUS", radius: number};
type createBranchPointActionType = {type: "CREATE_BRANCHPOINT", nodeId?: number, treeId?: number};
type deleteBranchPointActionType = {type: "DELETE_BRANCHPOINT"};
type createTreeActionType = {type: "CREATE_TREE"};
type deleteTreeActionType = {type: "DELETE_TREE", treeId?: number};
type setActiveTreeActionType = {type: "SET_ACTIVE_TREE", treeId: number};
type mergeTreesActionType = {type: "MERGE_TREES", sourceNodeId: number, targetNodeId: number};
type setTreeNameActionType = {type: "SET_TREE_NAME", treeId?: number, name: ?string};
type selectNextTreeActionType = {type: "SELECT_NEXT_TREE", forward: ?boolean};
type shuffleTreeColorActionType = {type: "SHUFFLE_TREE_COLOR", treeId?: number};
type createCommentActionType = {type: "CREATE_COMMENT", commentText: string, nodeId: ?number};
type deleteCommentActionType = {type: "DELETE_COMMENT", nodeId: ?number, treeId?: number};
type setVersionNumberActionType = {type: "SET_VERSION_NUMBER", version: number};

export type SkeletonTracingActionTypes = (initializeSkeletonTracingActionType | createNodeActionType | deleteNodeActionType | setActiveNodeActionType | setActiveNodeRadiusActionType | createBranchPointActionType | deleteBranchPointActionType | createTreeActionType | deleteTreeActionType | setActiveTreeActionType | mergeTreesActionType | setTreeNameActionType | setTreeNameActionType | selectNextTreeActionType | shuffleTreeColorActionType | createCommentActionType | deleteCommentActionType | setVersionNumberActionType);
export const SkeletonTracingActions = [
  "INITIALIZE_SKELETONTRACING",
  "CREATE_NODE",
  "DELETE_NODE",
  "SET_ACTIVE_NODE",
  "SET_ACTIVE_NODE_RADIUS",
  "CREATE_BRANCHPOINT",
  "DELETE_BRANCHPOINT",
  "CREATE_TREE",
  "DELETE_TREE",
  "SET_ACTIVE_TREE",
  "SET_TREE_NAME",
  "MERGE_TREES",
  "SELECT_NEXT_TREE",
  "SHUFFLE_TREE_COLOR",
  "CREATE_COMMENT",
  "DELETE_COMMENT",
];

export const initializeSkeletonTracingAction = (tracing: Tracing<SkeletonContentDataType>): initializeSkeletonTracingActionType => ({
  type: "INITIALIZE_SKELETONTRACING",
  tracing,
});

export const createNodeAction = (position: Vector3, rotation: Vector3, viewport: number, resolution: number, treeId?: number): createNodeActionType => ({
  type: "CREATE_NODE",
  position,
  rotation,
  viewport,
  resolution,
  treeId,
});

export const deleteNodeAction = (nodeId?: number, treeId?: number): deleteNodeActionType => ({
  type: "DELETE_NODE",
  nodeId,
  treeId,
});

export const setActiveNodeAction = (nodeId: number): (setActiveNodeActionType) => ({
  type: "SET_ACTIVE_NODE",
  nodeId,
});

export const setActiveNodeRadiusAction = (radius: number): setActiveNodeRadiusActionType => ({
  type: "SET_ACTIVE_NODE_RADIUS",
  radius,
});

export const createBranchPointAction = (nodeId?: number, treeId?: number): createBranchPointActionType => ({
  type: "CREATE_BRANCHPOINT",
  nodeId,
  treeId,
});

export const deleteBranchPointAction = (): deleteBranchPointActionType => ({
  type: "DELETE_BRANCHPOINT",
});

export const createTreeAction = (): createTreeActionType => ({
  type: "CREATE_TREE",
});

export const deleteTreeAction = (treeId?: number): deleteTreeActionType => ({
  type: "DELETE_TREE",
  treeId,
});

export const setActiveTreeAction = (treeId: number): setActiveTreeActionType => ({
  type: "SET_ACTIVE_TREE",
  treeId,
});

export const mergeTreesAction = (sourceNodeId: number, targetNodeId: number): mergeTreesActionType => ({
  type: "MERGE_TREES",
  sourceNodeId,
  targetNodeId,
});

export const setTreeNameAction = (name: ?string = null, treeId?: number): setTreeNameActionType => ({
  type: "SET_TREE_NAME",
  name,
  treeId,
});

// TODO consider a better name + better param name
export const selectNextTreeAction = (forward: ?boolean = true): selectNextTreeActionType => ({
  type: "SELECT_NEXT_TREE",
  forward,
});

export const shuffleTreeColorAction = (treeId: number): shuffleTreeColorActionType => ({
  type: "SHUFFLE_TREE_COLOR",
  treeId,
});

export const createCommentAction = (commentText: string, nodeId?: number, treeId?: number): createCommentActionType => ({
  type: "CREATE_COMMENT",
  commentText,
  nodeId,
  treeId,
});

export const deleteCommentAction = (nodeId?: number, treeId?: number): deleteCommentActionType => ({
  type: "DELETE_COMMENT",
  nodeId,
  treeId,
});

export const setVersionNumber = (version: number): setVersionNumberActionType => ({
  type: "SET_VERSION_NUMBER",
  version,
});
