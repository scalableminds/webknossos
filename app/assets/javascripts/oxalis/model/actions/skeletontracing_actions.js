/* eslint-disable import/prefer-default-export */

/**
 * skeletontracing_actions.js
 * @flow
 */
import type { Vector3 } from "oxalis/constants";
import type { Tracing } from "oxalis/model";
import type { SkeletonContentDataType } from "oxalis/store";

type initializeSkeletonTracingActionType = {type: "INITIALIZE_SKELETONTRACING", tracing: Tracing<SkeletonContentDataType> };
type createNodeActionType = {type: "CREATE_NODE", position: Vector3, rotation: Vector3, viewport: number, resolution: number};
type deleteNodeActionType = {type: "DELETE_NODE"};
type setActiveNodeActionType = {type: "SET_ACTIVE_NODE", nodeId: number, shouldMergeTree: boolean};
type setActiveNodeRadiusActionType = {type: "SET_ACTIVE_NODE_RADIUS", radius: number};
type createBranchPointActionType = {type: "CREATE_BRANCHPOINT"};
type deleteBranchPointActionType = {type: "DELETE_BRANCHPOINT"};
type createTreeActionType = {type: "CREATE_TREE"};
type deleteTreeActionType = {type: "DELETE_TREE"};
type setActiveTreeActionType = {type: "SET_ACTIVE_TREE", treeId: number};
type setTreeNameActionType = {type: "SET_TREE_NAME", name: ?string};
type selectNextTreeActionType = {type: "SELECT_NEXT_TREE", forward: ?boolean};
type shuffleTreeColorActionType = {type: "SHUFFLE_TREE_COLOR"};
type shuffleAllTreeColorsActionType = {type: "SHUFFLE_ALL_TREE_COLORS"};
type setCommentForNodeActionType = {type: "SET_COMMENT", nodeId: number, commentText: string};

export type SkeletonTracingActionTypes = initializeSkeletonTracingActionType | createNodeActionType | deleteNodeActionType | setActiveNodeActionType | setActiveNodeRadiusActionType | createBranchPointActionType | deleteBranchPointActionType | createTreeActionType | deleteTreeActionType | setActiveTreeActionType | setTreeNameActionType | selectNextTreeActionType | shuffleTreeColorActionType | shuffleAllTreeColorsActionType | setCommentForNodeActionType;

export const initializeSkeletonTracingAction = (tracing: Tracing<SkeletonContentDataType>): initializeSkeletonTracingActionType => ({
  type: "INITIALIZE_SKELETONTRACING",
  tracing,
});

export const createNodeAction = (position: Vector3, rotation: Vector3, viewport: number, resolution: number): createNodeActionType => ({
  type: "CREATE_NODE",
  position,
  rotation,
  viewport,
  resolution,
});

export const deleteNodeAction = (): deleteNodeActionType => ({
  type: "DELETE_NODE",
});

export const setActiveNodeAction = (nodeId: number, shouldMergeTree: boolean = false): setActiveNodeActionType => ({
  type: "SET_ACTIVE_NODE",
  nodeId,
  shouldMergeTree,
});

export const setActiveNodeRadiusAction = (radius: number): setActiveNodeRadiusActionType => ({
  type: "SET_ACTIVE_NODE_RADIUS",
  radius,
});

export const createBranchPointAction = (): createBranchPointActionType => ({
  type: "CREATE_BRANCHPOINT",
});

export const deleteBranchPointAction = (): deleteBranchPointActionType => ({
  type: "DELETE_BRANCHPOINT",
});

export const createTreeAction = (): createTreeActionType => ({
  type: "CREATE_TREE",
});

export const deleteTreeAction = (): deleteTreeActionType => ({
  type: "DELETE_TREE",
});

export const setActiveTreeAction = (treeId: number): setActiveTreeActionType => ({
  type: "SET_ACTIVE_TREE",
  treeId,
});

export const setTreeNameAction = (name: ?string = null): setTreeNameActionType => ({
  type: "SET_TREE_NAME",
  name,
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

export const setCommentForNodeAction = (nodeId: number, commentText: string): setCommentForNodeActionType => ({
  type: "SET_COMMENT",
  nodeId,
  commentText,
});
