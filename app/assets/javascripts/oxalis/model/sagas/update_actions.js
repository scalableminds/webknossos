// @flow
import type { SkeletonTracingType, VolumeTracingType, BranchPointType, CommentType, TreeType, NodeType } from "oxalis/store";
import type { Vector3 } from "oxalis/constants";

export type NodeWithTreeIdType = { treeId: number } & NodeType;

type UpdateTreeUpdateAction = {
  action: "createTree" | "updateTree",
  value: {
    id: number,
    updatedId: ?number,
    color: Vector3,
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
  value: NodeWithTreeIdType,
};
type UpdateNodeUpdateAction = {
  action: "updateNode",
  value: NodeWithTreeIdType,
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
type DeleteEdgeUpdateAction = {
  action: "deleteEdge",
  value: {
    treeId: number,
    source: number,
    target: number,
  }
};
type UpdateSkeletonTracingUpdateAction = {
  action: "updateTracing",
  value: {
    activeNode?: number,
    editPosition: Vector3,
    editRotation: Vector3,
    zoomLevel: number,
  },
};
type UpdateVolumeTracingUpdateAction = {
  action: "updateTracing",
  value: {
    activeCell: number,
    editPosition: Vector3,
    nextCell: number,
  }
}
type UpdateTracingUpdateAction = UpdateSkeletonTracingUpdateAction | UpdateVolumeTracingUpdateAction;

export type UpdateAction =
  UpdateTreeUpdateAction |
  DeleteTreeUpdateAction |
  MergeTreeUpdateAction |
  MoveTreeComponentUpdateAction |
  CreateNodeUpdateAction |
  UpdateNodeUpdateAction |
  DeleteNodeUpdateAction |
  CreateEdgeUpdateAction |
  DeleteEdgeUpdateAction |
  UpdateTracingUpdateAction;

export function createTree(tree: TreeType): UpdateTreeUpdateAction {
  return {
    action: "createTree",
    value: {
      id: tree.treeId,
      updatedId: undefined,
      color: tree.color,
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
  return {
    action: "updateTree",
    value: {
      id: tree.treeId,
      updatedId: tree.treeId,
      color: tree.color,
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
export function deleteEdge(treeId: number, sourceNodeId: number, targetNodeId: number): DeleteEdgeUpdateAction {
  return {
    action: "deleteEdge",
    value: {
      treeId,
      source: sourceNodeId,
      target: targetNodeId,
    },
  };
}
export function createNode(treeId: number, node: NodeType): CreateNodeUpdateAction {
  return {
    action: "createNode",
    value: Object.assign({}, node, { treeId, position: node.position }),
  };
}
export function updateNode(treeId: number, node: NodeType): UpdateNodeUpdateAction {
  return {
    action: "updateNode",
    value: Object.assign({}, node, { treeId, position: node.position }),
  };
}
export function deleteNode(treeId: number, nodeId: number): DeleteNodeUpdateAction {
  return {
    action: "deleteNode",
    value: { treeId, id: nodeId },
  };
}
export function updateSkeletonTracing(tracing: SkeletonTracingType, position: Vector3, rotation: Vector3, zoomLevel: number): UpdateSkeletonTracingUpdateAction {
  if (tracing.activeNodeId != null) {
    return {
      action: "updateTracing",
      value: {
        activeNode: tracing.activeNodeId,
        editPosition: position,
        editRotation: rotation,
        zoomLevel,
      },
    };
  }
  return {
    action: "updateTracing",
    value: {
      editPosition: position,
      editRotation: rotation,
      zoomLevel,
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
export function updateVolumeTracing(tracing: VolumeTracingType, position: Vector3): UpdateVolumeTracingUpdateAction {
  return {
    action: "updateTracing",
    value: {
      activeCell: tracing.activeCellId,
      editPosition: position,
      nextCell: tracing.idCount,
    },
  };
}
