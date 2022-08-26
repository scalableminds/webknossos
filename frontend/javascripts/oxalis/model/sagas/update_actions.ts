import type { SendBucketInfo } from "oxalis/model/bucket_data_handling/wkstore_adapter";
import type { Vector3 } from "oxalis/constants";
import type {
  VolumeTracing,
  BranchPoint,
  CommentType,
  Tree,
  Node,
  TreeGroup,
  UserBoundingBox,
  UserBoundingBoxToServer,
} from "oxalis/store";
import { convertUserBoundingBoxesFromFrontendToServer } from "oxalis/model/reducers/reducer_helpers";
export type NodeWithTreeId = {
  treeId: number;
} & Node;
export type UpdateTreeUpdateAction = {
  name: "createTree" | "updateTree";
  value: {
    id: number;
    updatedId: number | null | undefined;
    color: Vector3;
    name: string;
    comments: Array<CommentType>;
    branchPoints: Array<BranchPoint>;
    groupId: number | null | undefined;
    timestamp: number;
    isVisible: boolean;
  };
};
export type DeleteTreeUpdateAction = {
  name: "deleteTree";
  value: {
    id: number;
  };
};
export type MoveTreeComponentUpdateAction = {
  name: "moveTreeComponent";
  value: {
    sourceId: number;
    targetId: number;
    nodeIds: Array<number>;
  };
};
export type MergeTreeUpdateAction = {
  name: "mergeTree";
  value: {
    sourceId: number;
    targetId: number;
  };
};
export type CreateNodeUpdateAction = {
  name: "createNode";
  value: NodeWithTreeId;
};
export type UpdateNodeUpdateAction = {
  name: "updateNode";
  value: NodeWithTreeId;
};
export type UpdateTreeVisibilityUpdateAction = {
  name: "updateTreeVisibility";
  value: {
    treeId: number;
    isVisible: boolean;
  };
};
export type UpdateTreeGroupVisibilityUpdateAction = {
  name: "updateTreeGroupVisibility";
  value: {
    treeGroupId: number | null | undefined;
    isVisible: boolean;
  };
};
export type DeleteNodeUpdateAction = {
  name: "deleteNode";
  value: {
    treeId: number;
    nodeId: number;
  };
};
export type CreateEdgeUpdateAction = {
  name: "createEdge";
  value: {
    treeId: number;
    source: number;
    target: number;
  };
};
export type DeleteEdgeUpdateAction = {
  name: "deleteEdge";
  value: {
    treeId: number;
    source: number;
    target: number;
  };
};
export type UpdateSkeletonTracingUpdateAction = {
  name: "updateTracing";
  value: {
    activeNode: number | null | undefined;
    editPosition: Vector3;
    editRotation: Vector3;
    zoomLevel: number;
  };
};
type UpdateVolumeTracingUpdateAction = {
  name: "updateTracing";
  value: {
    activeSegmentId: number;
    editPosition: Vector3;
    editRotation: Vector3;
    // todo: clarify that the backend accepts this
    largestSegmentId: number | null;
    zoomLevel: number;
  };
};
export type CreateSegmentUpdateAction = {
  name: "createSegment";
  value: {
    id: number;
    anchorPosition: Vector3 | null | undefined;
    name: string | null | undefined;
    creationTime: number | null | undefined;
  };
};
export type UpdateSegmentUpdateAction = {
  name: "updateSegment";
  value: {
    id: number;
    anchorPosition: Vector3 | null | undefined;
    name: string | null | undefined;
    creationTime: number | null | undefined;
  };
};
export type DeleteSegmentUpdateAction = {
  name: "deleteSegment";
  value: {
    id: number;
  };
};
type UpdateUserBoundingBoxesUpdateAction = {
  name: "updateUserBoundingBoxes";
  value: {
    boundingBoxes: Array<UserBoundingBoxToServer>;
  };
};
export type UpdateBucketUpdateAction = {
  name: "updateBucket";
  value: SendBucketInfo & {
    base64Data: string;
  };
};
type UpdateTreeGroupsUpdateAction = {
  name: "updateTreeGroups";
  value: {
    treeGroups: Array<TreeGroup>;
  };
};
export type RevertToVersionUpdateAction = {
  name: "revertToVersion";
  value: {
    sourceVersion: number;
  };
};
// This action is not dispatched by our code, anymore,
// but we still need to keep it for backwards compatibility.
export type RemoveFallbackLayerUpdateAction = {
  name: "removeFallbackLayer";
  value: {};
};
export type UpdateTdCameraUpdateAction = {
  name: "updateTdCamera";
  value: {};
};
export type UpdateMappingNameUpdateAction = {
  name: "updateMappingName";
  value: {
    mappingName: string | null | undefined;
    isEditable: boolean | undefined;
  };
};
export type SplitAgglomerateUpdateAction = {
  name: "splitAgglomerate";
  value: {
    agglomerateId: number;
    segmentPosition1: Vector3;
    segmentPosition2: Vector3;
    mag: Vector3;
  };
};
export type MergeAgglomerateUpdateAction = {
  name: "mergeAgglomerate";
  value: {
    agglomerateId1: number;
    agglomerateId2: number;
    segmentPosition1: Vector3;
    segmentPosition2: Vector3;
    mag: Vector3;
  };
};
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
  | UpdateSkeletonTracingUpdateAction
  | UpdateVolumeTracingUpdateAction
  | UpdateUserBoundingBoxesUpdateAction
  | CreateSegmentUpdateAction
  | UpdateSegmentUpdateAction
  | DeleteSegmentUpdateAction
  | UpdateBucketUpdateAction
  | UpdateTreeVisibilityUpdateAction
  | UpdateTreeGroupVisibilityUpdateAction
  | RevertToVersionUpdateAction
  | UpdateTreeGroupsUpdateAction
  | RemoveFallbackLayerUpdateAction
  | UpdateTdCameraUpdateAction
  | UpdateMappingNameUpdateAction
  | SplitAgglomerateUpdateAction
  | MergeAgglomerateUpdateAction;
// This update action is only created in the frontend for display purposes
type CreateTracingUpdateAction = {
  name: "createTracing";
  value: {};
};
// This update action is only created by the backend
type ImportVolumeTracingUpdateAction = {
  name: "importVolumeTracing";
  value: {
    largestSegmentId: number;
  };
};
type AddServerValuesFn<T extends { value: any }> = (arg0: T) => T & {
  value: T["value"] & {
    actionTimestamp: number;
    actionAuthorId?: string;
  };
};

type AsServerAction<A extends { value: any }> = ReturnType<AddServerValuesFn<A>>;

export type ServerUpdateAction = AsServerAction<
  | UpdateAction
  // These two actions are never sent by the frontend and, therefore, don't exist in the UpdateAction type
  | ImportVolumeTracingUpdateAction
  | CreateTracingUpdateAction
>;

export function createTree(tree: Tree): UpdateTreeUpdateAction {
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
      groupId: tree.groupId,
      isVisible: tree.isVisible,
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
export function updateTree(tree: Tree): UpdateTreeUpdateAction {
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
      groupId: tree.groupId,
      isVisible: tree.isVisible,
    },
  };
}
export function updateTreeVisibility(tree: Tree): UpdateTreeVisibilityUpdateAction {
  const { treeId, isVisible } = tree;
  return {
    name: "updateTreeVisibility",
    value: {
      treeId,
      isVisible,
    },
  };
}
export function updateTreeGroupVisibility(
  groupId: number | null | undefined,
  isVisible: boolean,
): UpdateTreeGroupVisibilityUpdateAction {
  return {
    name: "updateTreeGroupVisibility",
    value: {
      treeGroupId: groupId,
      isVisible,
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
export function createNode(treeId: number, node: Node): CreateNodeUpdateAction {
  return {
    name: "createNode",
    value: Object.assign({}, node, {
      treeId,
    }),
  };
}
export function updateNode(treeId: number, node: Node): UpdateNodeUpdateAction {
  return {
    name: "updateNode",
    value: Object.assign({}, node, {
      treeId,
    }),
  };
}
export function deleteNode(treeId: number, nodeId: number): DeleteNodeUpdateAction {
  return {
    name: "deleteNode",
    value: {
      treeId,
      nodeId,
    },
  };
}
export function updateSkeletonTracing(
  tracing: {
    activeNodeId: number | null | undefined;
  },
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
  tracing: VolumeTracing,
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
      zoomLevel,
    },
  };
}
export function updateUserBoundingBoxes(
  userBoundingBoxes: Array<UserBoundingBox>,
): UpdateUserBoundingBoxesUpdateAction {
  return {
    name: "updateUserBoundingBoxes",
    value: {
      boundingBoxes: convertUserBoundingBoxesFromFrontendToServer(userBoundingBoxes),
    },
  };
}
export function createSegmentVolumeAction(
  id: number,
  anchorPosition: Vector3 | null | undefined,
  name: string | null | undefined,
  creationTime: number | null | undefined = Date.now(),
): CreateSegmentUpdateAction {
  return {
    name: "createSegment",
    value: {
      id,
      anchorPosition,
      name,
      creationTime,
    },
  };
}
export function updateSegmentVolumeAction(
  id: number,
  anchorPosition: Vector3 | null | undefined,
  name: string | null | undefined,
  creationTime: number | null | undefined = Date.now(),
): UpdateSegmentUpdateAction {
  return {
    name: "updateSegment",
    value: {
      id,
      anchorPosition,
      name,
      creationTime,
    },
  };
}
export function deleteSegmentVolumeAction(id: number): DeleteSegmentUpdateAction {
  return {
    name: "deleteSegment",
    value: {
      id,
    },
  };
}
export function updateBucket(
  bucketInfo: SendBucketInfo,
  base64Data: string,
): UpdateBucketUpdateAction {
  return {
    name: "updateBucket",
    value: Object.assign({}, bucketInfo, {
      base64Data,
    }),
  };
}
export function updateTreeGroups(treeGroups: Array<TreeGroup>): UpdateTreeGroupsUpdateAction {
  return {
    name: "updateTreeGroups",
    value: {
      treeGroups,
    },
  };
}
export function revertToVersion(version: number): RevertToVersionUpdateAction {
  return {
    name: "revertToVersion",
    value: {
      sourceVersion: version,
    },
  };
}
export function removeFallbackLayer(): RemoveFallbackLayerUpdateAction {
  return {
    name: "removeFallbackLayer",
    value: {},
  };
}
export function updateTdCamera(): UpdateTdCameraUpdateAction {
  return {
    name: "updateTdCamera",
    value: {},
  };
}
export function serverCreateTracing(timestamp: number): AsServerAction<CreateTracingUpdateAction> {
  return {
    name: "createTracing",
    value: {
      actionTimestamp: timestamp,
    },
  };
}
export function updateMappingName(
  mappingName: string | null | undefined,
  isEditable: boolean | undefined,
): UpdateMappingNameUpdateAction {
  return {
    name: "updateMappingName",
    value: { mappingName, isEditable },
  };
}
export function splitAgglomerate(
  agglomerateId: number,
  segmentPosition1: Vector3,
  segmentPosition2: Vector3,
  mag: Vector3,
): SplitAgglomerateUpdateAction {
  return {
    name: "splitAgglomerate",
    value: {
      agglomerateId,
      segmentPosition1,
      segmentPosition2,
      mag,
    },
  };
}
export function mergeAgglomerate(
  agglomerateId1: number,
  agglomerateId2: number,
  segmentPosition1: Vector3,
  segmentPosition2: Vector3,
  mag: Vector3,
): MergeAgglomerateUpdateAction {
  return {
    name: "mergeAgglomerate",
    value: {
      agglomerateId1,
      agglomerateId2,
      segmentPosition1,
      segmentPosition2,
      mag,
    },
  };
}
