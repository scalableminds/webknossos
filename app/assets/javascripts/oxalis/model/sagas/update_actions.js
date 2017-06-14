// @flow
import _ from "lodash";
import Date from "libs/date";
import type {
  SkeletonTracingType,
  VolumeTracingType,
  BranchPointType,
  CommentType,
  TreeType,
  NodeType,
  TreeMapType,
  TemporaryMutableTreeMapType,
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
  }
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
  }
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
  }
};
type DeleteEdgeUpdateAction = {
  action: "deleteEdge",
  timestamp: number,
  value: {
    treeId: number,
    source: number,
    target: number,
  }
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
export function createEdge(treeId: number, sourceNodeId: number, targetNodeId: number): CreateEdgeUpdateAction {
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
export function deleteEdge(treeId: number, sourceNodeId: number, targetNodeId: number): DeleteEdgeUpdateAction {
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
export function updateSkeletonTracing(tracing: SkeletonTracingType, position: Vector3, rotation: Vector3, zoomLevel: number): UpdateSkeletonTracingUpdateAction {
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
export function moveTreeComponent(sourceTreeId: number, targetTreeId: number, nodeIds: Array<number>): MoveTreeComponentUpdateAction {
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
export function updateVolumeTracing(tracing: VolumeTracingType, position: Vector3): UpdateVolumeTracingUpdateAction {
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

export function updateActionReducer(trees: TreeMapType, updateActions: Array<UpdateAction>): TreeMapType {
  // Clone the trees object and flow-cast to allow to modify the deep clone
  const clonedTrees = ((_.cloneDeep(trees): any): TemporaryMutableTreeMapType);

  // Apply all update actions on the trees object
  return updateActions.reduce((acc, ua) => {
    switch (ua.action) {
      case "updateTree": {
        const uaTree = ua.value;
        acc[uaTree.id] = Object.assign({}, acc[uaTree.id], {
          branchPoints: uaTree.branchPoints,
          color: uaTree.color,
          comments: uaTree.comments,
          name: uaTree.name,
          timestamp: uaTree.timestamp,
          treeId: uaTree.id,
        });
        return acc;
      }
      case "createTree": {
        const uaTree = ua.value;
        acc[uaTree.id] = {
          branchPoints: uaTree.branchPoints,
          color: uaTree.color,
          comments: uaTree.comments,
          edges: [],
          name: uaTree.name,
          nodes: {},
          timestamp: uaTree.timestamp,
          treeId: uaTree.id,
        };
        return acc;
      }
      case "deleteTree": {
        delete acc[ua.value.id];
        return acc;
      }
      case "createEdge": {
        const uaEdge = ua.value;
        acc[uaEdge.treeId].edges.push({
          source: uaEdge.source,
          target: uaEdge.target,
        });
        return acc;
      }
      case "deleteEdge": {
        const uaEdge = ua.value;
        _.remove(acc[uaEdge.treeId].edges, edge =>
          edge.source === uaEdge.source &&
            edge.target === uaEdge.target,
        );
        return acc;
      }
      case "updateNode":
      case "createNode": {
        const uaNodeCopy = _.cloneDeep(ua.value);
        delete uaNodeCopy.treeId;
        acc[ua.value.treeId].nodes[uaNodeCopy.id] = uaNodeCopy;
        return acc;
      }
      case "deleteNode": {
        delete acc[ua.value.treeId].nodes[ua.value.id];
        return acc;
      }
      case "moveTreeComponent": {
        // Move all nodes that are part of the moveTreeComponent update action
        for (const nodeId of ua.value.nodeIds) {
          acc[ua.value.targetId].nodes[nodeId] = acc[ua.value.sourceId].nodes[nodeId];
          delete acc[ua.value.sourceId].nodes[nodeId];
        }
        // Move all edges that are between nodes that are part of the moveTreeComponent update action
        const edges = _.clone(acc[ua.value.sourceId].edges);
        for (const edge of edges) {
          if (_.indexOf(ua.value.nodeIds, edge.source) >= 0 && _.indexOf(ua.value.nodeIds, edge.target) >= 0) {
            acc[ua.value.targetId].edges.push(edge);
            _.remove(acc[ua.value.sourceId].edges, edge);
          }
        }
        return acc;
      }
      default: {
        return acc;
      }
    }
  }, clonedTrees);
}
