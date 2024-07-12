import type { SendBucketInfo } from "oxalis/model/bucket_data_handling/wkstore_adapter";
import type { Vector3 } from "oxalis/constants";
import type {
  VolumeTracing,
  Tree,
  Node,
  TreeGroup,
  UserBoundingBox,
  SegmentGroup,
  NumberLike,
} from "oxalis/store";
import { convertUserBoundingBoxesFromFrontendToServer } from "oxalis/model/reducers/reducer_helpers";
import { AdditionalCoordinate } from "types/api_flow_types";

export type NodeWithTreeId = {
  treeId: number;
} & Node;

export type UpdateTreeUpdateAction = ReturnType<typeof updateTree> | ReturnType<typeof createTree>;
export type DeleteTreeUpdateAction = ReturnType<typeof deleteTree>;
export type MoveTreeComponentUpdateAction = ReturnType<typeof moveTreeComponent>;
export type MergeTreeUpdateAction = ReturnType<typeof mergeTree>;
export type CreateNodeUpdateAction = ReturnType<typeof createNode>;
export type UpdateNodeUpdateAction = ReturnType<typeof updateNode>;
export type UpdateTreeVisibilityUpdateAction = ReturnType<typeof updateTreeVisibility>;
export type UpdateTreeEdgesVisibilityUpdateAction = ReturnType<typeof updateTreeEdgesVisibility>;
export type UpdateTreeGroupVisibilityUpdateAction = ReturnType<typeof updateTreeGroupVisibility>;
export type DeleteNodeUpdateAction = ReturnType<typeof deleteNode>;
export type CreateEdgeUpdateAction = ReturnType<typeof createEdge>;
export type DeleteEdgeUpdateAction = ReturnType<typeof deleteEdge>;
export type UpdateSkeletonTracingUpdateAction = ReturnType<typeof updateSkeletonTracing>;
type UpdateVolumeTracingUpdateAction = ReturnType<typeof updateVolumeTracing>;
export type CreateSegmentUpdateAction = ReturnType<typeof createSegmentVolumeAction>;
export type UpdateSegmentUpdateAction = ReturnType<typeof updateSegmentVolumeAction>;
export type DeleteSegmentUpdateAction = ReturnType<typeof deleteSegmentVolumeAction>;
export type DeleteSegmentDataUpdateAction = ReturnType<typeof deleteSegmentDataVolumeAction>;
type UpdateUserBoundingBoxesUpdateAction = ReturnType<typeof updateUserBoundingBoxes>;
export type UpdateBucketUpdateAction = ReturnType<typeof updateBucket>;
type UpdateSegmentGroupsUpdateAction = ReturnType<typeof updateSegmentGroups>;

type UpdateTreeGroupsUpdateAction = ReturnType<typeof updateTreeGroups>;

export type RevertToVersionUpdateAction = ReturnType<typeof revertToVersion>;
// This action is not dispatched by our code, anymore,
// but we still need to keep it for backwards compatibility.
export type RemoveFallbackLayerUpdateAction = ReturnType<typeof removeFallbackLayer>;
export type UpdateTdCameraUpdateAction = ReturnType<typeof updateTdCamera>;
export type UpdateMappingNameUpdateAction = ReturnType<typeof updateMappingName>;
export type SplitAgglomerateUpdateAction = ReturnType<typeof splitAgglomerate>;
export type MergeAgglomerateUpdateAction = ReturnType<typeof mergeAgglomerate>;

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
  | DeleteSegmentDataUpdateAction
  | UpdateBucketUpdateAction
  | UpdateTreeVisibilityUpdateAction
  | UpdateTreeEdgesVisibilityUpdateAction
  | UpdateTreeGroupVisibilityUpdateAction
  | RevertToVersionUpdateAction
  | UpdateSegmentGroupsUpdateAction
  | UpdateTreeGroupsUpdateAction
  | RemoveFallbackLayerUpdateAction
  | UpdateTdCameraUpdateAction
  | UpdateMappingNameUpdateAction
  | SplitAgglomerateUpdateAction
  | MergeAgglomerateUpdateAction;
// This update action is only created in the frontend for display purposes
type CreateTracingUpdateAction = {
  name: "createTracing";
  value: {
    actionTimestamp: number;
  };
};
// This update action is only created by the backend
type ImportVolumeTracingUpdateAction = {
  name: "importVolumeTracing";
  value: {
    largestSegmentId: number;
  };
}; // This update action is only created by the backend
type AddSegmentIndexUpdateAction = {
  name: "addSegmentIndex";
  value: {
    actionTimestamp: number;
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
  | AddSegmentIndexUpdateAction
  | CreateTracingUpdateAction
>;

export function createTree(tree: Tree) {
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
      type: tree.type,
      edgesAreVisible: tree.edgesAreVisible,
    },
  } as const;
}
export function deleteTree(treeId: number) {
  return {
    name: "deleteTree",
    value: {
      id: treeId,
    },
  } as const;
}
export function updateTree(tree: Tree) {
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
      type: tree.type,
      edgesAreVisible: tree.edgesAreVisible,
    },
  } as const;
}
export function updateTreeVisibility(tree: Tree) {
  const { treeId, isVisible } = tree;
  return {
    name: "updateTreeVisibility",
    value: {
      treeId,
      isVisible,
    },
  } as const;
}
export function updateTreeEdgesVisibility(tree: Tree) {
  const { treeId, edgesAreVisible } = tree;
  return {
    name: "updateTreeEdgesVisibility",
    value: {
      treeId,
      edgesAreVisible,
    },
  } as const;
}
export function updateTreeGroupVisibility(groupId: number | null | undefined, isVisible: boolean) {
  return {
    name: "updateTreeGroupVisibility",
    value: {
      treeGroupId: groupId,
      isVisible,
    },
  } as const;
}
export function mergeTree(sourceTreeId: number, targetTreeId: number) {
  return {
    name: "mergeTree",
    value: {
      sourceId: sourceTreeId,
      targetId: targetTreeId,
    },
  } as const;
}
export function createEdge(treeId: number, sourceNodeId: number, targetNodeId: number) {
  return {
    name: "createEdge",
    value: {
      treeId,
      source: sourceNodeId,
      target: targetNodeId,
    },
  } as const;
}
export function deleteEdge(treeId: number, sourceNodeId: number, targetNodeId: number) {
  return {
    name: "deleteEdge",
    value: {
      treeId,
      source: sourceNodeId,
      target: targetNodeId,
    },
  } as const;
}

export type UpdateActionNode = Omit<Node, "untransformedPosition"> & {
  position: Node["untransformedPosition"];
  treeId: number;
};

export function createNode(treeId: number, node: Node) {
  const { untransformedPosition, ...restNode } = node;
  return {
    name: "createNode",
    value: { ...restNode, position: untransformedPosition, treeId } as UpdateActionNode,
  } as const;
}
export function updateNode(treeId: number, node: Node) {
  const { untransformedPosition, ...restNode } = node;
  return {
    name: "updateNode",
    value: {
      ...restNode,
      position: untransformedPosition,
      treeId,
    } as UpdateActionNode,
  } as const;
}
export function deleteNode(treeId: number, nodeId: number) {
  return {
    name: "deleteNode",
    value: {
      treeId,
      nodeId,
    },
  } as const;
}
export function updateSkeletonTracing(
  tracing: {
    activeNodeId: number | null | undefined;
  },
  editPosition: Vector3,
  editPositionAdditionalCoordinates: AdditionalCoordinate[] | null,
  rotation: Vector3,
  zoomLevel: number,
) {
  return {
    name: "updateTracing",
    value: {
      activeNode: tracing.activeNodeId,
      editPosition,
      editPositionAdditionalCoordinates,
      editRotation: rotation,
      zoomLevel,
    },
  } as const;
}
export function moveTreeComponent(
  sourceTreeId: number,
  targetTreeId: number,
  nodeIds: Array<number>,
) {
  return {
    name: "moveTreeComponent",
    value: {
      sourceId: sourceTreeId,
      targetId: targetTreeId,
      nodeIds,
    },
  } as const;
}
export function updateVolumeTracing(
  tracing: VolumeTracing,
  position: Vector3,
  editPositionAdditionalCoordinates: AdditionalCoordinate[] | null,
  rotation: Vector3,
  zoomLevel: number,
) {
  return {
    name: "updateTracing",
    value: {
      activeSegmentId: tracing.activeCellId,
      editPosition: position,
      editPositionAdditionalCoordinates,
      editRotation: rotation,
      largestSegmentId: tracing.largestSegmentId,
      zoomLevel,
    },
  } as const;
}
export function updateUserBoundingBoxes(userBoundingBoxes: Array<UserBoundingBox>) {
  return {
    name: "updateUserBoundingBoxes",
    value: {
      boundingBoxes: convertUserBoundingBoxesFromFrontendToServer(userBoundingBoxes),
    },
  } as const;
}
export function createSegmentVolumeAction(
  id: number,
  anchorPosition: Vector3 | null | undefined,
  name: string | null | undefined,
  color: Vector3 | null,
  groupId: number | null | undefined,
  creationTime: number | null | undefined = Date.now(),
) {
  return {
    name: "createSegment",
    value: {
      id,
      anchorPosition,
      name,
      color,
      groupId,
      creationTime,
    },
  } as const;
}
export function updateSegmentVolumeAction(
  id: number,
  anchorPosition: Vector3 | null | undefined,
  additionalCoordinates: AdditionalCoordinate[] | undefined | null,
  name: string | null | undefined,
  color: Vector3 | null,
  groupId: number | null | undefined,
  creationTime: number | null | undefined = Date.now(),
) {
  return {
    name: "updateSegment",
    value: {
      id,
      anchorPosition,
      additionalCoordinates,
      name,
      color,
      groupId,
      creationTime,
    },
  } as const;
}
export function deleteSegmentVolumeAction(id: number) {
  return {
    name: "deleteSegment",
    value: {
      id,
    },
  } as const;
}
export function deleteSegmentDataVolumeAction(id: number) {
  return {
    name: "deleteSegmentData",
    value: {
      id,
    },
  } as const;
}
export function updateBucket(bucketInfo: SendBucketInfo, base64Data: string) {
  return {
    name: "updateBucket",
    value: Object.assign({}, bucketInfo, {
      base64Data,
    }),
  } as const;
}

export function updateSegmentGroups(segmentGroups: Array<SegmentGroup>) {
  return {
    name: "updateSegmentGroups",
    value: {
      segmentGroups,
    },
  } as const;
}

export function updateTreeGroups(treeGroups: Array<TreeGroup>) {
  return {
    name: "updateTreeGroups",
    value: {
      treeGroups,
    },
  } as const;
}
export function revertToVersion(version: number) {
  return {
    name: "revertToVersion",
    value: {
      sourceVersion: version,
    },
  } as const;
}
export function removeFallbackLayer() {
  return {
    name: "removeFallbackLayer",
    value: {},
  } as const;
}
export function updateTdCamera() {
  return {
    name: "updateTdCamera",
    value: {},
  } as const;
}
export function serverCreateTracing(timestamp: number) {
  return {
    name: "createTracing",
    value: {
      actionTimestamp: timestamp,
    },
  } as const;
}
export function updateMappingName(
  mappingName: string | null | undefined,
  isEditable: boolean | null | undefined,
  isLocked: boolean | undefined,
) {
  return {
    name: "updateMappingName",
    value: { mappingName, isEditable, isLocked },
  } as const;
}
export function splitAgglomerate(
  agglomerateId: NumberLike,
  segmentId1: NumberLike,
  segmentId2: NumberLike,
  mag: Vector3,
): {
  name: "splitAgglomerate";
  value: {
    agglomerateId: number;
    mag: Vector3;
    // For backwards compatibility reasons,
    // older segments are defined using their positions
    // instead of their unmapped ids.
    segmentId1: number | undefined;
    segmentId2: number | undefined;
    segmentPosition1?: Vector3 | undefined;
    segmentPosition2?: Vector3 | undefined;
  };
} {
  return {
    name: "splitAgglomerate",
    value: {
      // TODO #6581: Uint64 Support
      agglomerateId: Number(agglomerateId),
      segmentId1: Number(segmentId1),
      segmentId2: Number(segmentId2),
      mag,
    },
  } as const;
}
export function mergeAgglomerate(
  agglomerateId1: NumberLike,
  agglomerateId2: NumberLike,
  segmentId1: NumberLike,
  segmentId2: NumberLike,
  mag: Vector3,
): {
  name: "mergeAgglomerate";
  value: {
    agglomerateId1: number;
    agglomerateId2: number;
    mag: Vector3;
    // For backwards compatibility reasons,
    // older segments are defined using their positions
    // instead of their unmapped ids.
    segmentId1: number | undefined;
    segmentId2: number | undefined;
    segmentPosition1?: Vector3 | undefined;
    segmentPosition2?: Vector3 | undefined;
  };
} {
  return {
    name: "mergeAgglomerate",
    value: {
      // TODO #6581: Uint64 Support
      agglomerateId1: Number(agglomerateId1),
      agglomerateId2: Number(agglomerateId2),
      segmentId1: Number(segmentId1),
      segmentId2: Number(segmentId2),
      mag,
    },
  } as const;
}
