import type { Vector3 } from "oxalis/constants";
import type { SendBucketInfo } from "oxalis/model/bucket_data_handling/wkstore_adapter";
import { convertUserBoundingBoxesFromFrontendToServer } from "oxalis/model/reducers/reducer_helpers";
import type {
  Node,
  NumberLike,
  SegmentGroup,
  Tree,
  TreeGroup,
  UserBoundingBox,
  VolumeTracing,
} from "oxalis/store";
import type {
  APIMagRestrictions,
  AdditionalCoordinate,
  MetadataEntryProto,
} from "types/api_flow_types";

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
type UpdateUserBoundingBoxesInSkeletonTracingUpdateAction = ReturnType<
  typeof updateUserBoundingBoxesInSkeletonTracing
>;
type UpdateUserBoundingBoxesInVolumeTracingUpdateAction = ReturnType<
  typeof updateUserBoundingBoxesInVolumeTracing
>;
export type UpdateBucketUpdateAction = ReturnType<typeof updateBucket>;
export type UpdateSegmentGroupsUpdateAction = ReturnType<typeof updateSegmentGroups>;

type UpdateTreeGroupsUpdateAction = ReturnType<typeof updateTreeGroups>;

export type RevertToVersionUpdateAction = ReturnType<typeof revertToVersion>;
// This action is not dispatched by our code, anymore,
// but we still need to keep it for backwards compatibility.
export type RemoveFallbackLayerUpdateAction = ReturnType<typeof removeFallbackLayer>;
export type UpdateTdCameraUpdateAction = ReturnType<typeof updateTdCamera>;
export type UpdateMappingNameUpdateAction = ReturnType<typeof updateMappingName>;
export type AddLayerToAnnotationUpdateAction = ReturnType<typeof addLayerToAnnotation>;
export type DeleteAnnotationLayerUpdateAction = ReturnType<typeof deleteAnnotationLayer>;
export type UpdateAnnotationLayerNameUpdateAction = ReturnType<typeof updateAnnotationLayerName>;
export type UpdateMetadataOfAnnotationUpdateAction = ReturnType<typeof updateMetadataOfAnnotation>;
export type SplitAgglomerateUpdateAction = ReturnType<typeof splitAgglomerate>;
export type MergeAgglomerateUpdateAction = ReturnType<typeof mergeAgglomerate>;

// There are two types of UpdateActions. The ones that *need* to be in a separate transaction
// group. And the ones that don't have this requirement.
export type UpdateAction =
  | UpdateActionWithoutIsolationRequirement
  | UpdateActionWithIsolationRequirement;

export type UpdateActionWithIsolationRequirement =
  | RevertToVersionUpdateAction
  | AddLayerToAnnotationUpdateAction;
export type UpdateActionWithoutIsolationRequirement =
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
  | UpdateUserBoundingBoxesInSkeletonTracingUpdateAction
  | UpdateUserBoundingBoxesInVolumeTracingUpdateAction
  | CreateSegmentUpdateAction
  | UpdateSegmentUpdateAction
  | DeleteSegmentUpdateAction
  | DeleteSegmentDataUpdateAction
  | UpdateBucketUpdateAction
  | UpdateTreeVisibilityUpdateAction
  | UpdateTreeEdgesVisibilityUpdateAction
  | UpdateTreeGroupVisibilityUpdateAction
  | UpdateSegmentGroupsUpdateAction
  | UpdateTreeGroupsUpdateAction
  | RemoveFallbackLayerUpdateAction
  | UpdateTdCameraUpdateAction
  | UpdateMappingNameUpdateAction
  | DeleteAnnotationLayerUpdateAction
  | UpdateAnnotationLayerNameUpdateAction
  | UpdateMetadataOfAnnotationUpdateAction
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
};
// This update action is only created by the backend
export type AddSegmentIndexUpdateAction = {
  name: "addSegmentIndex";
  value: {
    actionTimestamp: number;
    actionTracingId: string;
  };
};
type AddServerValuesFn<T extends { value: any }> = (arg0: T) => T & {
  value: T["value"] & {
    actionTimestamp: number;
    actionAuthorId?: string;
  };
};

type AsServerAction<A extends { value: any }> = ReturnType<AddServerValuesFn<A>>;

// When the server delivers update actions (e.g., when requesting the version history
// of an annotation), ServerUpdateActions are sent which include some additional information.
export type ServerUpdateAction = AsServerAction<
  | UpdateAction
  // These two actions are never sent by the frontend and, therefore, don't exist in the UpdateAction type
  | ImportVolumeTracingUpdateAction
  | AddSegmentIndexUpdateAction
  | CreateTracingUpdateAction
>;

export function createTree(tree: Tree, actionTracingId: string) {
  return {
    name: "createTree",
    value: {
      actionTracingId,
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
      metadata: enforceValidMetadata(tree.metadata),
    },
  } as const;
}
export function deleteTree(treeId: number, actionTracingId: string) {
  return {
    name: "deleteTree",
    value: {
      actionTracingId,
      id: treeId,
    },
  } as const;
}
export function updateTree(tree: Tree, actionTracingId: string) {
  return {
    name: "updateTree",
    value: {
      actionTracingId,
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
      metadata: enforceValidMetadata(tree.metadata),
    },
  } as const;
}
export function updateTreeVisibility(tree: Tree, actionTracingId: string) {
  const { treeId, isVisible } = tree;
  return {
    name: "updateTreeVisibility",
    value: {
      actionTracingId,
      treeId,
      isVisible,
    },
  } as const;
}
export function updateTreeEdgesVisibility(tree: Tree, actionTracingId: string) {
  const { treeId, edgesAreVisible } = tree;
  return {
    name: "updateTreeEdgesVisibility",
    value: {
      actionTracingId,
      treeId,
      edgesAreVisible,
    },
  } as const;
}
export function updateTreeGroupVisibility(
  groupId: number | null | undefined,
  isVisible: boolean,
  actionTracingId: string,
) {
  return {
    name: "updateTreeGroupVisibility",
    value: {
      actionTracingId,
      treeGroupId: groupId,
      isVisible,
    },
  } as const;
}
export function mergeTree(sourceTreeId: number, targetTreeId: number, actionTracingId: string) {
  return {
    name: "mergeTree",
    value: {
      actionTracingId,
      sourceId: sourceTreeId,
      targetId: targetTreeId,
    },
  } as const;
}
export function createEdge(
  treeId: number,
  sourceNodeId: number,
  targetNodeId: number,
  actionTracingId: string,
) {
  return {
    name: "createEdge",
    value: {
      actionTracingId,
      treeId,
      source: sourceNodeId,
      target: targetNodeId,
    },
  } as const;
}
export function deleteEdge(
  treeId: number,
  sourceNodeId: number,
  targetNodeId: number,
  actionTracingId: string,
) {
  return {
    name: "deleteEdge",
    value: {
      actionTracingId,
      treeId,
      source: sourceNodeId,
      target: targetNodeId,
    },
  } as const;
}

export type CreateActionNode = Omit<Node, "untransformedPosition" | "mag"> & {
  position: Node["untransformedPosition"];
  treeId: number;
  resolution: number;
};

export type UpdateActionNode = Omit<Node, "untransformedPosition"> & {
  position: Node["untransformedPosition"];
  treeId: number;
};

export function createNode(treeId: number, node: Node, actionTracingId: string) {
  const { untransformedPosition, mag, ...restNode } = node;
  return {
    name: "createNode",
    value: {
      actionTracingId,
      ...restNode,
      position: untransformedPosition,
      treeId,
      resolution: mag,
    } as CreateActionNode,
  } as const;
}
export function updateNode(treeId: number, node: Node, actionTracingId: string) {
  const { untransformedPosition, ...restNode } = node;
  return {
    name: "updateNode",
    value: {
      actionTracingId,
      ...restNode,
      position: untransformedPosition,
      treeId,
    } as UpdateActionNode,
  } as const;
}
export function deleteNode(treeId: number, nodeId: number, actionTracingId: string) {
  return {
    name: "deleteNode",
    value: {
      actionTracingId,
      treeId,
      nodeId,
    },
  } as const;
}
export function updateSkeletonTracing(
  tracing: {
    tracingId: string;
    activeNodeId: number | null | undefined;
  },
  editPosition: Vector3,
  editPositionAdditionalCoordinates: AdditionalCoordinate[] | null,
  rotation: Vector3,
  zoomLevel: number,
) {
  return {
    name: "updateSkeletonTracing",
    value: {
      actionTracingId: tracing.tracingId,
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
  actionTracingId: string,
) {
  return {
    name: "moveTreeComponent",
    value: {
      actionTracingId,
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
    name: "updateVolumeTracing",
    value: {
      actionTracingId: tracing.tracingId,
      activeSegmentId: tracing.activeCellId,
      editPosition: position,
      editPositionAdditionalCoordinates,
      editRotation: rotation,
      largestSegmentId: tracing.largestSegmentId,
      zoomLevel,
    },
  } as const;
}

export function addUserBoundingBoxSkeletonAction(
  boundingBox: UserBoundingBox,
  actionTracingId: string,
  timestamp: number | null,
  authorId: string | null,
  info: string | null,
) {
  return {
    name: "addUserBoundingBoxSkeleton",
    value: {
      boundingBox: convertUserBoundingBoxesFromFrontendToServer([boundingBox]),
      actionTracingId,
      actionTimestamp: timestamp,
      actionAuthorId: authorId,
      info,
    },
  } as const;
}

export function addUserBoundingBoxInVolumeTracingAction(
  boundingBox: UserBoundingBox,
  actionTracingId: string,
  timestamp: number | null,
  authorId: string | null,
  info: string | null,
) {
  return {
    name: "addUserBoundingBoxSkeleton",
    value: {
      boundingBox: convertUserBoundingBoxesFromFrontendToServer([boundingBox]),
      actionTracingId,
      actionTimestamp: timestamp,
      actionAuthorId: authorId,
      info,
    },
  } as const;
}

export function deleteUserBoundingBoxInSkeletonTracingAction(
  boundingBoxId: number,
  actionTracingId: string,
  timestamp: number | null,
  authorId: string | null,
  info: string | null,
) {
  return {
    name: "deleteUserBoundingBoxSkeletonAction",
    value: {
      boundingBoxId,
      actionTracingId,
      actionTimestamp: timestamp,
      actionAuthorId: authorId,
      info,
    },
  } as const;
}

export function deleteUserBoundingBoxInVolumeTracingAction(
  boundingBoxId: number,
  actionTracingId: string,
  timestamp: number | null,
  authorId: string | null,
  info: string | null,
) {
  return {
    name: "deleteUserBoundingBoxVolumeAction",
    value: {
      boundingBoxId,
      actionTracingId,
      actionTimestamp: timestamp,
      actionAuthorId: authorId,
      info,
    },
  } as const;
}

export function updateUserBoundingBoxInSkeletonTracingAction(
  boundingBoxId: number,
  updatedProps: Partial<UserBoundingBox>,
  actionTracingId: string,
  timestamp: number | null,
  authorId: string | null,
  info: string | null,
) {
  const updatedPropKeys = Object.keys(updatedProps);
  return {
    name: "updateUserBoundingBoxSkeletonAction",
    value: {
      boundingBoxId,
      actionTracingId,
      updatedProps,
      updatedPropKeys,
      actionTimestamp: timestamp,
      actionAuthorId: authorId,
      info,
    },
  } as const;
}

export function updateUserBoundingBoxInVolumeTracingAction(
  boundingBoxId: number,
  updatedProps: Partial<UserBoundingBox>,
  actionTracingId: string,
  timestamp: number | null,
  authorId: string | null,
  info: string | null,
) {
  const updatedPropKeys = Object.keys(updatedProps);
  return {
    name: "updateUserBoundingBoxVolumeAction",
    value: {
      boundingBoxId,
      actionTracingId,
      updatedProps,
      updatedPropKeys,
      actionTimestamp: timestamp,
      actionAuthorId: authorId,
      info,
    },
  } as const;
}

export function updateUserBoundingBoxesInSkeletonTracing(
  userBoundingBoxes: Array<UserBoundingBox>,
  actionTracingId: string,
) {
  return {
    name: "updateUserBoundingBoxesInSkeletonTracing",
    value: {
      actionTracingId,
      boundingBoxes: convertUserBoundingBoxesFromFrontendToServer(userBoundingBoxes),
    },
  } as const;
}
export function updateUserBoundingBoxesInVolumeTracing(
  userBoundingBoxes: Array<UserBoundingBox>,
  actionTracingId: string,
) {
  return {
    name: "updateUserBoundingBoxesInVolumeTracing",
    value: {
      actionTracingId,
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
  metadata: MetadataEntryProto[],
  actionTracingId: string,
  creationTime: number | null | undefined = Date.now(),
) {
  return {
    name: "createSegment",
    value: {
      actionTracingId,
      id,
      anchorPosition,
      name,
      color,
      groupId,
      metadata: enforceValidMetadata(metadata),
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
  metadata: Array<MetadataEntryProto>,
  actionTracingId: string,
  creationTime: number | null | undefined = Date.now(),
) {
  return {
    name: "updateSegment",
    value: {
      actionTracingId,
      id,
      anchorPosition,
      additionalCoordinates,
      name,
      color,
      groupId,
      metadata: enforceValidMetadata(metadata),
      creationTime,
    },
  } as const;
}
export function deleteSegmentVolumeAction(id: number, actionTracingId: string) {
  return {
    name: "deleteSegment",
    value: {
      actionTracingId,
      id,
    },
  } as const;
}
export function deleteSegmentDataVolumeAction(id: number, actionTracingId: string) {
  return {
    name: "deleteSegmentData",
    value: {
      actionTracingId,
      id,
    },
  } as const;
}
export function updateBucket(
  bucketInfo: SendBucketInfo,
  base64Data: string,
  actionTracingId: string,
) {
  return {
    name: "updateBucket",
    value: {
      actionTracingId,
      ...bucketInfo,
      base64Data,
    },
  } as const;
}

export function updateSegmentGroups(segmentGroups: Array<SegmentGroup>, actionTracingId: string) {
  return {
    name: "updateSegmentGroups",
    value: {
      actionTracingId,
      segmentGroups,
    },
  } as const;
}

export function updateTreeGroups(treeGroups: Array<TreeGroup>, actionTracingId: string) {
  return {
    name: "updateTreeGroups",
    value: {
      actionTracingId,
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
export function removeFallbackLayer(actionTracingId: string) {
  return {
    name: "removeFallbackLayer",
    value: {
      actionTracingId,
    },
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
  actionTracingId: string,
) {
  return {
    name: "updateMappingName",
    value: {
      actionTracingId,
      mappingName,
      isEditable,
      isLocked,
    },
  } as const;
}
export function splitAgglomerate(
  agglomerateId: NumberLike,
  segmentId1: NumberLike,
  segmentId2: NumberLike,
  mag: Vector3,
  actionTracingId: string,
): {
  name: "splitAgglomerate";
  value: {
    actionTracingId: string;
    agglomerateId: number;
    segmentId1: number | undefined;
    segmentId2: number | undefined;
    // For backwards compatibility reasons,
    // older segments are defined using their positions (and mag)
    // instead of their unmapped ids.
    segmentPosition1?: Vector3 | undefined;
    segmentPosition2?: Vector3 | undefined;
    mag: Vector3;
  };
} {
  return {
    name: "splitAgglomerate",
    value: {
      actionTracingId,
      // TODO: Proper 64 bit support (#6921)
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
  actionTracingId: string,
): {
  name: "mergeAgglomerate";
  value: {
    actionTracingId: string;
    agglomerateId1: number;
    agglomerateId2: number;
    segmentId1: number | undefined;
    segmentId2: number | undefined;
    // For backwards compatibility reasons,
    // older segments are defined using their positions (and mag)
    // instead of their unmapped ids.
    segmentPosition1?: Vector3 | undefined;
    segmentPosition2?: Vector3 | undefined;
    mag: Vector3;
  };
} {
  return {
    name: "mergeAgglomerate",
    value: {
      actionTracingId,
      // TODO: Proper 64 bit support (#6921)
      agglomerateId1: Number(agglomerateId1),
      agglomerateId2: Number(agglomerateId2),
      segmentId1: Number(segmentId1),
      segmentId2: Number(segmentId2),
      mag,
    },
  } as const;
}

type AnnotationLayerCreationParameters = {
  typ: "Skeleton" | "Volume";
  name: string | null | undefined;
  autoFallbackLayer?: boolean;
  fallbackLayerName?: string | null | undefined;
  mappingName?: string | null | undefined;
  magRestrictions?: APIMagRestrictions | null | undefined;
};

export function addLayerToAnnotation(parameters: AnnotationLayerCreationParameters) {
  return {
    name: "addLayerToAnnotation",
    value: { layerParameters: parameters },
  } as const;
}

export function deleteAnnotationLayer(
  tracingId: string,
  layerName: string,
  typ: "Skeleton" | "Volume",
) {
  return {
    name: "deleteLayerFromAnnotation",
    value: { tracingId, layerName, typ },
  } as const;
}

export function updateAnnotationLayerName(tracingId: string, newLayerName: string) {
  return {
    name: "updateLayerMetadata",
    value: { tracingId, layerName: newLayerName },
  } as const;
}

export function updateMetadataOfAnnotation(description: string) {
  return {
    name: "updateMetadataOfAnnotation",
    value: { description },
  } as const;
}

function enforceValidMetadata(metadata: MetadataEntryProto[]): MetadataEntryProto[] {
  // We do not want to save metadata with duplicate keys. Validation errors
  // will warn the user in case this exists. However, we allow duplicate keys in the
  // redux store to avoid losing information while the user is editing something.
  // Instead, entries with duplicate keys are filtered here so that the back-end will
  // not see this.
  // If the user chooses to ignore the warnings, only the first appearance of a key
  // is saved to the back-end.
  const keySet = new Set();
  const filteredProps = [];
  for (const prop of metadata) {
    if (!keySet.has(prop.key)) {
      keySet.add(prop.key);
      filteredProps.push(prop);
    }
  }
  return filteredProps;
}
