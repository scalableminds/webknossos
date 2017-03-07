// @flow
import type { SkeletonTracingType, BranchPointType, CommentType, TreeType, NodeType } from "oxalis/store";
import type { Vector3, Vector4 } from "oxalis/constants";
import { Color } from "three";
import { V3 } from "libs/mjs";

type UpdateTreeUpdateAction = {
  action: "createTree" | "updateTree",
  value: {
    id: number,
    updatedId: ?number,
    color: Vector4,
    name: string,
    timestamp: number,
    comments: Array<CommentType>,
    branchPoints: Array<BranchPointType>,
  }
};
type DeleteTreeUpdateAction = {
  action: "deleteTree", value: { id: number },
};
type MoveTreeComponentUpdateAction = {
  action: "moveTreeComponent",
  value: {
    sourceId: number,
    targetId: number,
    nodeIds: Array<number>,
  }
}
type MergeTreeUpdateAction = {
  action: "mergeTree",
  value: {
    sourceId: number,
    targetId: number,
  },
};
type CreateNodeUpdateAction = {
  action: "createNode",
  value: NodeType,
};
type UpdateNodeUpdateAction = {
  action: "updateNode",
  value: NodeType,
};
type DeleteNodeUpdateAction = {
  action: "deleteNode",
  value: {
    treeId: number,
    id: number,
  },
};
type CreateEdgeUpdateAction = {
  action: "createEdge",
  value: {
    treeId: number,
    source: number,
    target: number,
  }
};
type UpdateTracingUpdateAction = {
  action: "updateTracing",
  value: {
    activeNode: number,
    editPosition: Vector3,
    editRotation: Vector3,
    zoomLevel: number,
  },
};

export type UpdateAction =
  UpdateTreeUpdateAction |
  DeleteTreeUpdateAction |
  MergeTreeUpdateAction |
  MoveTreeComponentUpdateAction |
  CreateNodeUpdateAction |
  UpdateNodeUpdateAction |
  DeleteNodeUpdateAction |
  CreateEdgeUpdateAction |
  // DeleteEdgeUpdateAction |
  UpdateTracingUpdateAction;

export function createTree(tree: TreeType): UpdateTreeUpdateAction {
  const treeColor = new Color(tree.color);
  return {
    action: "createTree",
    value: {
      id: tree.treeId,
      updatedId: undefined,
      color: [treeColor.r, treeColor.g, treeColor.b, 1],
      name: tree.name,
      timestamp: tree.timestamp,
      comments: tree.comments,
      branchPoints: tree.branchPoints,
    },
  };
}
export function deleteTree(treeId: number): DeleteTreeUpdateAction {
  return {
    action: "deleteTree",
    value: {
      id: treeId,
    },
  };
}
export function updateTree(tree: TreeType): UpdateTreeUpdateAction {
  const treeColor = new Color(tree.color);
  return {
    action: "updateTree",
    value: {
      id: tree.treeId,
      updatedId: tree.treeId,
      color: [treeColor.r, treeColor.g, treeColor.b, 1],
      name: tree.name,
      timestamp: tree.timestamp,
      comments: tree.comments,
      branchPoints: tree.branchPoints,
    },
  };
}
export function mergeTree(sourceTreeId: number, targetTreeId: number): MergeTreeUpdateAction {
  return {
    action: "mergeTree",
    value: {
      sourceId: sourceTreeId,
      targetId: targetTreeId,
    },
  };
}
export function createEdge(treeId: number, sourceNodeId: number, targetNodeId: number): CreateEdgeUpdateAction {
  return {
    action: "createEdge",
    value: {
      treeId,
      source: sourceNodeId,
      target: targetNodeId,
    },
  };
}
export function createNode(node: NodeType): CreateNodeUpdateAction {
  return {
    action: "createNode",
    value: node,
  };
}
export function updateNode(node: NodeType): UpdateNodeUpdateAction {
  return {
    action: "updateNode",
    value: node,
  };
}
export function deleteNode(treeId: number, node: NodeType): DeleteNodeUpdateAction {
  return {
    action: "deleteNode",
    value: { treeId, id: node.id },
  };
}
export function updateTracing(tracing: SkeletonTracingType): UpdateTracingUpdateAction {
  return {
    action: "updateTracing",
    value: {
      activeNode: tracing.activeNodeId,
      editPosition: V3.floor(window.webknossos.model.flycam.getPosition()),
      editRotation: window.webknossos.model.flycam3d.getRotation(),
      zoomLevel: window.webknossos.model.flycam.getZoomStep(),
    },
  };
}
export function moveTreeComponent(sourceTreeId: number, targetTreeId: number, nodeIds: Array<number>): MoveTreeComponentUpdateAction {
  return {
    action: "moveTreeComponent",
    value: {
      sourceId: sourceTreeId,
      targetId: targetTreeId,
      nodeIds,
    },
  };
}
