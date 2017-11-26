// @flow
import type {
  SkeletonTracingType,
  VolumeTracingType,
  BranchPointType,
  CommentType,
  TreeType,
  NodeType,
  BoundingBoxObjectType,
} from "oxalis/store";
import type { Vector3 } from "oxalis/constants";
import type { BucketInfo } from "oxalis/model/binary/layers/bucket_builder";
import { convertFrontendBoundingBoxToServer } from "oxalis/model/reducers/reducer_helpers";

export type NodeWithTreeIdType = { treeId: number } & NodeType;

type UpdateTreeUpdateAction = {
  name: "createTree" | "updateTree",
  value: {
    id: number,
    updatedId: ?number,
    color: Vector3,
    name: string,
    comments: Array<CommentType>,
    branchPoints: Array<BranchPointType>,
  },
};
type DeleteTreeUpdateAction = {
  name: "deleteTree",
  value: { id: number },
};
type MoveTreeComponentUpdateAction = {
  name: "moveTreeComponent",
  value: {
    sourceId: number,
    targetId: number,
    nodeIds: Array<number>,
  },
};
type MergeTreeUpdateAction = {
  name: "mergeTree",
  value: {
    sourceId: number,
    targetId: number,
  },
};
type CreateNodeUpdateAction = {
  name: "createNode",
  value: NodeWithTreeIdType,
};
type UpdateNodeUpdateAction = {
  name: "updateNode",
  value: NodeWithTreeIdType,
};
type ToggleTreeUpdateAction = {
  name: "toggleTree",
  value: {
    id: number,
  },
};
type DeleteNodeUpdateAction = {
  name: "deleteNode",
  value: {
    treeId: number,
    nodeId: number,
  },
};
type CreateEdgeUpdateAction = {
  name: "createEdge",
  value: {
    treeId: number,
    source: number,
    target: number,
  },
};
type DeleteEdgeUpdateAction = {
  name: "deleteEdge",
  value: {
    treeId: number,
    source: number,
    target: number,
  },
};
type UpdateSkeletonTracingUpdateAction = {
  name: "updateTracing",
  value: {
    activeNode: ?number,
    editPosition: Vector3,
    editRotation: Vector3,
    userBoundingBox: ?BoundingBoxObjectType,
    zoomLevel: number,
  },
};
type UpdateVolumeTracingUpdateAction = {
  name: "updateTracing",
  value: {
    activeSegmentId: number,
    editPosition: Vector3,
    editRotation: Vector3,
    largestSegmentId: number,
    userBoundingBox: ?BoundingBoxObjectType,
    zoomLevel: number,
  },
};
type UpdateBucketUpdateAction = {
  name: "updateBucket",
  value: BucketInfo & {
    base64Data: string,
  },
};
type UpdateTracingUpdateAction =
  | UpdateSkeletonTracingUpdateAction
  | UpdateVolumeTracingUpdateAction;

export type UpdateAction =
  | UpdateTreeUpdateAction
  | DeleteTreeUpdateAction
  | MergeTreeUpdateAction
  | MoveTreeComponentUpdateAction
  | CreateNodeUpdateAction
  | UpdateNodeUpdateAction
  | DeleteNodeUpdateAction
  | CreateEdgeUpdateAction
  | DeleteEdgeUpdateAction
  | UpdateTracingUpdateAction
  | UpdateBucketUpdateAction
  | ToggleTreeUpdateAction;

export function createTree(tree: TreeType): UpdateTreeUpdateAction {
  return {
    name: "createTree",
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
    name: "deleteTree",
    value: {
      id: treeId,
    },
  };
}
export function updateTree(tree: TreeType): UpdateTreeUpdateAction {
  return {
    name: "updateTree",
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
    name: "toggleTree",
    value: {
      id: tree.treeId,
    },
  };
}
export function mergeTree(sourceTreeId: number, targetTreeId: number): MergeTreeUpdateAction {
  return {
    name: "mergeTree",
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
    name: "createEdge",
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
    name: "deleteEdge",
    value: {
      treeId,
      source: sourceNodeId,
      target: targetNodeId,
    },
  };
}
export function createNode(treeId: number, node: NodeType): CreateNodeUpdateAction {
  return {
    name: "createNode",
    value: Object.assign({}, node, { treeId }),
  };
}
export function updateNode(treeId: number, node: NodeType): UpdateNodeUpdateAction {
  return {
    name: "updateNode",
    value: Object.assign({}, node, { treeId }),
  };
}
export function deleteNode(treeId: number, nodeId: number): DeleteNodeUpdateAction {
  return {
    name: "deleteNode",
    value: { treeId, nodeId },
  };
}
export function updateSkeletonTracing(
  tracing: SkeletonTracingType,
  position: Vector3,
  rotation: Vector3,
  zoomLevel: number,
): UpdateSkeletonTracingUpdateAction {
  return {
    name: "updateTracing",
    value: {
      activeNode: tracing.activeNodeId,
      editPosition: position,
      editRotation: rotation,
      userBoundingBox: convertFrontendBoundingBoxToServer(tracing.userBoundingBox),
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
    name: "moveTreeComponent",
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
  rotation: Vector3,
  zoomLevel: number,
): UpdateVolumeTracingUpdateAction {
  return {
    name: "updateTracing",
    value: {
      activeSegmentId: tracing.activeCellId,
      editPosition: position,
      editRotation: rotation,
      largestSegmentId: tracing.maxCellId,
      userBoundingBox: convertFrontendBoundingBoxToServer(tracing.userBoundingBox),
      zoomLevel,
    },
  };
}
export function updateBucket(bucketInfo: BucketInfo, base64Data: string) {
  return {
    name: "updateBucket",
    value: Object.assign({}, bucketInfo, {
      base64Data,
    }),
  };
}
