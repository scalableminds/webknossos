// @flow
import Date from "libs/date";
import type {
  SkeletonTracingType,
  VolumeTracingType,
  BranchPointType,
  CommentType,
  TreeType,
  NodeType,
} from "oxalis/store";
import type { Vector3 } from "oxalis/constants";

export type NodeWithTreeIdType = { treeId: number } & NodeType;

type UpdateTreeUpdateAction = {
  action: "createTree" | "updateTree",
  timestamp: number,
  value: {
    id: number,
    updatedId: ?number,
    color: Vector3,
    name: string,
    timestamp: number,
    comments: Array<CommentType>,
    branchPoints: Array<BranchPointType>,
  },
};
type DeleteTreeUpdateAction = {
  action: "deleteTree",
  timestamp: number,
  value: { id: number },
};
type MoveTreeComponentUpdateAction = {
  action: "moveTreeComponent",
  timestamp: number,
  value: {
    sourceId: number,
    targetId: number,
    nodeIds: Array<number>,
  },
};
type MergeTreeUpdateAction = {
  action: "mergeTree",
  timestamp: number,
  value: {
    sourceId: number,
    targetId: number,
  },
};
type CreateNodeUpdateAction = {
  action: "createNode",
  timestamp: number,
  value: NodeWithTreeIdType,
};
type UpdateNodeUpdateAction = {
  action: "updateNode",
  timestamp: number,
  value: NodeWithTreeIdType,
};
type ToggleTreeUpdateAction = {
  action: "toggleTree",
  timestamp: number,
  value: {
    id: number,
  },
}
type DeleteNodeUpdateAction = {
  action: "deleteNode",
  timestamp: number,
  value: {
    treeId: number,
    id: number,
  },
};
type CreateEdgeUpdateAction = {
  action: "createEdge",
  timestamp: number,
  value: {
    treeId: number,
    source: number,
    target: number,
  },
};
type DeleteEdgeUpdateAction = {
  action: "deleteEdge",
  timestamp: number,
  value: {
    treeId: number,
    source: number,
    target: number,
  },
};
type UpdateSkeletonTracingUpdateAction = {
  action: "updateTracing",
  timestamp: number,
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
  },
};
type UpdateTracingUpdateAction =
  | UpdateSkeletonTracingUpdateAction
  | UpdateVolumeTracingUpdateAction;

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
  UpdateTracingUpdateAction |
  ToggleTreeUpdateAction;

export function createTree(tree: TreeType): UpdateTreeUpdateAction {
  return {
    action: "createTree",
    timestamp: Date.now(),
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
    timestamp: Date.now(),
    value: {
      id: treeId,
    },
  };
}
export function updateTree(tree: TreeType): UpdateTreeUpdateAction {
  return {
    action: "updateTree",
    timestamp: Date.now(),
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
export function toggleTree(tree: TreeType): ToggleTreeUpdateAction {
  return {
    action: "toggleTree",
    timestamp: Date.now(),
    value: {
      id: tree.treeId,
    }
  };
}
export function mergeTree(sourceTreeId: number, targetTreeId: number): MergeTreeUpdateAction {
  return {
    action: "mergeTree",
    timestamp: Date.now(),
    value: {
      sourceId: sourceTreeId,
      targetId: targetTreeId,
    },
  };
}
export function createEdge(
  treeId: number,
  sourceNodeId: number,
  targetNodeId: number,
): CreateEdgeUpdateAction {
  return {
    action: "createEdge",
    timestamp: Date.now(),
    value: {
      treeId,
      source: sourceNodeId,
      target: targetNodeId,
    },
  };
}
export function deleteEdge(
  treeId: number,
  sourceNodeId: number,
  targetNodeId: number,
): DeleteEdgeUpdateAction {
  return {
    action: "deleteEdge",
    timestamp: Date.now(),
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
    timestamp: Date.now(),
    value: Object.assign({}, node, { treeId }),
  };
}
export function updateNode(treeId: number, node: NodeType): UpdateNodeUpdateAction {
  return {
    action: "updateNode",
    timestamp: Date.now(),
    value: Object.assign({}, node, { treeId }),
  };
}
export function deleteNode(treeId: number, nodeId: number): DeleteNodeUpdateAction {
  return {
    action: "deleteNode",
    timestamp: Date.now(),
    value: { treeId, id: nodeId },
  };
}
export function updateSkeletonTracing(
  tracing: SkeletonTracingType,
  position: Vector3,
  rotation: Vector3,
  zoomLevel: number,
): UpdateSkeletonTracingUpdateAction {
  const curTime = Date.now();
  if (tracing.activeNodeId != null) {
    return {
      action: "updateTracing",
      timestamp: curTime,
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
    timestamp: curTime,
    value: {
      editPosition: position,
      editRotation: rotation,
      zoomLevel,
    },
  };
}
export function moveTreeComponent(
  sourceTreeId: number,
  targetTreeId: number,
  nodeIds: Array<number>,
): MoveTreeComponentUpdateAction {
  return {
    action: "moveTreeComponent",
    timestamp: Date.now(),
    value: {
      sourceId: sourceTreeId,
      targetId: targetTreeId,
      nodeIds,
    },
  };
}
export function updateVolumeTracing(
  tracing: VolumeTracingType,
  position: Vector3,
): UpdateVolumeTracingUpdateAction {
  return {
    action: "updateTracing",
    timestamp: Date.now(),
    value: {
      activeCell: tracing.activeCellId,
      editPosition: position,
      nextCell: tracing.maxCellId + 1,
    },
  };
}
