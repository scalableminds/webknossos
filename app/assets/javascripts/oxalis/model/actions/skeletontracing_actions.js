/* eslint-disable import/prefer-default-export */

/**
 * skeletontracing_actions.js
 * @flow
 */
import type { Vector3 } from "oxalis/constants";
import type { Tracing } from "oxalis/model";
import type TraceTree from "oxalis/model/skeletontracing/tracetree";

type initializeSkeletonTracingActionType = {type: "INITIALIZE_SKELETONTRACING", tracing: Tracing };

export type SkeletonTracingActionTypes = initializeSkeletonTracingActionType;

export const initializeSkeletonTracingAction = (tracing: Tracing): initializeSkeletonTracingActionType => ({
  type: "INITIALIZE_SKELETONTRACING",
  tracing,
});

export const createNodeAction = (position: Vector3, rotation: Vector3, viewport: number, resolution: number) => ({
  type: "CREATE_NODE",
  position,
  rotation,
  viewport,
  resolution,
});

export const deleteNodeAction = () => ({
  type: "DELETE_NODE",
});

export const setActiveNodeAction = (nodeId: number, shouldMergeTree: boolean = false, shouldCenter: boolean = false) => ({
  type: "SET_ACTIVE_NODE",
  nodeId,
  shouldMergeTree,
  shouldCenter,
});

export const setActiveNodeRadiusAction = (radius: number) => ({
  type: "SET_ACTIVE_NODE_RADIUS",
  radius,
});

export const createBranchPointAction = () => ({
  type: "CREATE_BRANCHPOINT",
});

export const deleteBranchPointAction = () => ({
  type: "DELETE_BRANCHPOINT",
});

export const createTreeAction = () => ({
  type: "CREATE_TREE",
});

export const deleteTreeAction = () => ({
  type: "DELETE_TREE",
});

export const setActiveTreeAction = (treeId: number) => ({
  type: "SET_ACTIVE_TREE",
  treeId,
});

export const setTreeNameAction = (name: string) => ({
  type: "SET_TREE_NAME",
  name,
});

// TODO consider a better name + better param name
export const selectNextTreeAction = (forward: boolean) => ({
  type: "SELECT_NEXT_TREE",
  forward,
});

export const shuffleTreeColorAction = () => ({
  type: "SHUFFLE_TREE_COLOR",
});

export const shuffleAllTreeColorsAction = () => ({
  type: "SHUFFLE_ALL_TREE_COLORS",
});

export const setCommentForNodeAction = (nodeId: number, commentText: string) => ({
  type: "SET_COMMENT",
  nodeId,
  commentText,
});
