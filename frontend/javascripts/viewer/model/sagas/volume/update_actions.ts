import * as Utils from "libs/utils";
import type { APIMagRestrictions, AdditionalCoordinate, MetadataEntryProto } from "types/api_types";
import type { Vector3 } from "viewer/constants";
import type { SendBucketInfo } from "viewer/model/bucket_data_handling/wkstore_adapter";
import { convertUserBoundingBoxFromFrontendToServer } from "viewer/model/reducers/reducer_helpers";
import type { Node, Tree, TreeGroup } from "viewer/model/types/tree_types";
import type {
  BoundingBoxObject,
  NumberLike,
  SegmentGroup,
  UserBoundingBox,
  UserBoundingBoxWithOptIsVisible,
  VolumeTracing,
} from "viewer/store";

export type NodeWithTreeId = {
  treeId: number;
} & Node;

// This type is meant to contain only the properties that have changed
type PartialBoundingBoxWithoutVisibility = Partial<Omit<UserBoundingBox, "isVisible">>;

export type UpdateTreeUpdateAction = ReturnType<typeof updateTree> | ReturnType<typeof createTree>;
export type DeleteTreeUpdateAction = ReturnType<typeof deleteTree>;
export type MoveTreeComponentUpdateAction = ReturnType<typeof moveTreeComponent>;
export type LEGACY_MergeTreeUpdateAction = ReturnType<typeof LEGACY_mergeTree>;
export type CreateNodeUpdateAction = ReturnType<typeof createNode>;
export type UpdateNodeUpdateAction = ReturnType<typeof updateNode>;
export type UpdateTreeVisibilityUpdateAction = ReturnType<typeof updateTreeVisibility>;
export type UpdateTreeEdgesVisibilityUpdateAction = ReturnType<typeof updateTreeEdgesVisibility>;
export type UpdateTreeGroupVisibilityUpdateAction = ReturnType<typeof updateTreeGroupVisibility>;
export type DeleteNodeUpdateAction = ReturnType<typeof deleteNode>;
export type CreateEdgeUpdateAction = ReturnType<typeof createEdge>;
export type DeleteEdgeUpdateAction = ReturnType<typeof deleteEdge>;
export type UpdateActiveNodeUpdateAction = ReturnType<typeof updateActiveNode>;
type LEGACY_UpdateSkeletonTracingUpdateAction = ReturnType<typeof LEGACY_updateSkeletonTracing>;
type LEGACY_UpdateVolumeTracingUpdateAction = ReturnType<typeof LEGACY_updateVolumeTracingAction>;
export type UpdateActiveSegmentIdUpdateAction = ReturnType<typeof updateActiveSegmentId>;
export type UpdateLargestSegmentIdVolumeAction = ReturnType<typeof updateLargestSegmentId>;
export type CreateSegmentUpdateAction = ReturnType<typeof createSegmentVolumeAction>;
export type UpdateSegmentUpdateAction = ReturnType<typeof updateSegmentVolumeAction>;
export type UpdateSegmentVisibilityVolumeAction = ReturnType<
  typeof updateSegmentVisibilityVolumeAction
>;
export type UpdateSegmentGroupVisibilityVolumeAction = ReturnType<
  typeof updateSegmentGroupVisibilityVolumeAction
>;
export type DeleteSegmentUpdateAction = ReturnType<typeof deleteSegmentVolumeAction>;
export type DeleteSegmentDataUpdateAction = ReturnType<typeof deleteSegmentDataVolumeAction>;
export type LEGACY_UpdateUserBoundingBoxesInSkeletonTracingUpdateAction = ReturnType<
  typeof LEGACY_updateUserBoundingBoxesInSkeletonTracing
>;
export type LEGACY_UpdateUserBoundingBoxesInVolumeTracingUpdateAction = ReturnType<
  typeof LEGACY_updateUserBoundingBoxesInVolumeTracing
>;
export type AddUserBoundingBoxInSkeletonTracingAction = ReturnType<
  typeof addUserBoundingBoxInSkeletonTracing
>;
export type AddUserBoundingBoxInVolumeTracingAction = ReturnType<
  typeof addUserBoundingBoxInVolumeTracing
>;
export type DeleteUserBoundingBoxInSkeletonTracingAction = ReturnType<
  typeof deleteUserBoundingBoxInSkeletonTracing
>;
export type DeleteUserBoundingBoxInVolumeTracingAction = ReturnType<
  typeof deleteUserBoundingBoxInVolumeTracing
>;
export type UpdateUserBoundingBoxInSkeletonTracingAction = ReturnType<
  typeof updateUserBoundingBoxInSkeletonTracing
>;
export type UpdateUserBoundingBoxInVolumeTracingAction = ReturnType<
  typeof updateUserBoundingBoxInVolumeTracing
>;
export type UpdateUserBoundingBoxVisibilityInSkeletonTracingAction = ReturnType<
  typeof updateUserBoundingBoxVisibilityInSkeletonTracing
>;
export type UpdateUserBoundingBoxVisibilityInVolumeTracingAction = ReturnType<
  typeof updateUserBoundingBoxVisibilityInVolumeTracing
>;
export type UpdateBucketUpdateAction = ReturnType<typeof updateBucket>;
export type UpdateSegmentGroupsUpdateAction = ReturnType<typeof updateSegmentGroups>;
export type UpdateSegmentGroupsExpandedStateUpdateAction = ReturnType<
  typeof updateSegmentGroupsExpandedState
>;

type UpdateTreeGroupsUpdateAction = ReturnType<typeof updateTreeGroups>;
export type UpdateTreeGroupsExpandedStateAction = ReturnType<typeof updateTreeGroupsExpandedState>;

export type RevertToVersionUpdateAction = ReturnType<typeof revertToVersion>;
// This action is not dispatched by our code, anymore,
// but we still need to keep it for backwards compatibility.
export type RemoveFallbackLayerUpdateAction = ReturnType<typeof removeFallbackLayer>;
export type UpdateCameraAnnotationAction = ReturnType<typeof updateCameraAnnotation>;
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

type _ApplicableSkeletonUpdateAction =
  | UpdateTreeUpdateAction
  | UpdateNodeUpdateAction
  | CreateNodeUpdateAction
  | CreateEdgeUpdateAction
  | DeleteTreeUpdateAction
  | DeleteEdgeUpdateAction
  | DeleteNodeUpdateAction
  | MoveTreeComponentUpdateAction
  | UpdateTreeEdgesVisibilityUpdateAction
  | UpdateTreeGroupsUpdateAction
  | UpdateTreeGroupsExpandedStateAction
  | AddUserBoundingBoxInSkeletonTracingAction
  | UpdateUserBoundingBoxInSkeletonTracingAction
  | UpdateUserBoundingBoxVisibilityInSkeletonTracingAction
  | DeleteUserBoundingBoxInSkeletonTracingAction
  // User specific actions
  | UpdateActiveNodeUpdateAction
  | UpdateTreeVisibilityUpdateAction
  | UpdateTreeGroupVisibilityUpdateAction
  | UpdateUserBoundingBoxVisibilityInSkeletonTracingAction
  | UpdateTreeGroupsExpandedStateAction;

export type ApplicableSkeletonServerUpdateAction = AsServerAction<_ApplicableSkeletonUpdateAction>;
export type WithoutServerSpecificFields<T extends { value: Record<string, any> }> = Omit<
  T,
  "value"
> & {
  value: Omit<T["value"], "actionTimestamp" | "actionTracingId">;
};
export type ApplicableSkeletonUpdateAction =
  WithoutServerSpecificFields<ApplicableSkeletonServerUpdateAction>;

export type ApplicableVolumeUpdateAction =
  | UpdateLargestSegmentIdVolumeAction
  | UpdateSegmentUpdateAction
  | CreateSegmentUpdateAction
  | DeleteSegmentUpdateAction
  | UpdateSegmentGroupsUpdateAction
  | AddUserBoundingBoxInVolumeTracingAction
  | UpdateUserBoundingBoxInVolumeTracingAction
  | DeleteUserBoundingBoxInVolumeTracingAction
  | UpdateSegmentGroupsExpandedStateUpdateAction
  | UpdateUserBoundingBoxVisibilityInVolumeTracingAction
  // User specific actions
  | UpdateActiveSegmentIdUpdateAction
  | UpdateSegmentVisibilityVolumeAction
  | UpdateSegmentGroupVisibilityVolumeAction
  | UpdateUserBoundingBoxInVolumeTracingAction
  | UpdateSegmentGroupsExpandedStateUpdateAction;

export type UpdateActionWithIsolationRequirement =
  | RevertToVersionUpdateAction
  | AddLayerToAnnotationUpdateAction;
export type UpdateActionWithoutIsolationRequirement =
  | UpdateTreeUpdateAction
  | DeleteTreeUpdateAction
  | LEGACY_MergeTreeUpdateAction
  | MoveTreeComponentUpdateAction
  | CreateNodeUpdateAction
  | UpdateNodeUpdateAction
  | DeleteNodeUpdateAction
  | CreateEdgeUpdateAction
  | DeleteEdgeUpdateAction
  | LEGACY_UpdateSkeletonTracingUpdateAction
  | LEGACY_UpdateVolumeTracingUpdateAction
  | LEGACY_UpdateUserBoundingBoxesInSkeletonTracingUpdateAction
  | LEGACY_UpdateUserBoundingBoxesInVolumeTracingUpdateAction
  | UpdateActiveNodeUpdateAction
  | UpdateActiveSegmentIdUpdateAction
  | UpdateLargestSegmentIdVolumeAction
  | AddUserBoundingBoxInSkeletonTracingAction
  | AddUserBoundingBoxInVolumeTracingAction
  | DeleteUserBoundingBoxInSkeletonTracingAction
  | DeleteUserBoundingBoxInVolumeTracingAction
  | UpdateUserBoundingBoxInSkeletonTracingAction
  | UpdateUserBoundingBoxInVolumeTracingAction
  | UpdateUserBoundingBoxVisibilityInSkeletonTracingAction
  | UpdateUserBoundingBoxVisibilityInVolumeTracingAction
  | CreateSegmentUpdateAction
  | UpdateSegmentUpdateAction
  | UpdateSegmentVisibilityVolumeAction
  | DeleteSegmentUpdateAction
  | DeleteSegmentDataUpdateAction
  | UpdateBucketUpdateAction
  | UpdateTreeVisibilityUpdateAction
  | UpdateTreeEdgesVisibilityUpdateAction
  | UpdateTreeGroupVisibilityUpdateAction
  | UpdateSegmentGroupsUpdateAction
  | UpdateSegmentGroupsExpandedStateUpdateAction
  | UpdateSegmentGroupVisibilityVolumeAction
  | UpdateTreeGroupsUpdateAction
  | UpdateTreeGroupsExpandedStateAction
  | RemoveFallbackLayerUpdateAction
  | UpdateCameraAnnotationAction
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

export type AsServerAction<A extends { value: any }> = ReturnType<AddServerValuesFn<A>>;

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
      updatedId: undefined, // was never really used, but is kept to keep the type information precise
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
export function LEGACY_mergeTree(
  sourceTreeId: number,
  targetTreeId: number,
  actionTracingId: string,
) {
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
  actionTracingId: string;
};

export type UpdateActionNode = Omit<Node, "untransformedPosition"> & {
  position: Node["untransformedPosition"];
  treeId: number;
  actionTracingId: string;
};

export function createNode(treeId: number, node: Node, actionTracingId: string) {
  const { untransformedPosition, mag, ...restNode } = node;
  const value: CreateActionNode = {
    actionTracingId,
    ...restNode,
    position: untransformedPosition,
    treeId,
    resolution: mag,
  };
  return {
    name: "createNode",
    value,
  } as const;
}
export function updateNode(treeId: number, node: Node, actionTracingId: string) {
  const { untransformedPosition, ...restNode } = node;
  const value: UpdateActionNode = {
    actionTracingId,
    ...restNode,
    position: untransformedPosition,
    treeId,
  };
  return {
    name: "updateNode",
    value,
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

// This action only exists for legacy reasons. Old annotations may have this
// action in the action log. Don't use it.
function LEGACY_updateSkeletonTracing(
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

export function updateActiveNode(tracing: {
  tracingId: string;
  activeNodeId: number | null | undefined;
}) {
  return {
    name: "updateActiveNode",
    value: {
      actionTracingId: tracing.tracingId,
      activeNode: tracing.activeNodeId,
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

// This action only exists for legacy reasons. Old annotations may have this
// action in the action log. Don't use it.
export function LEGACY_updateVolumeTracingAction(
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
      hideUnregisteredSegments: tracing.hideUnregisteredSegments,
      zoomLevel,
    },
  } as const;
}

export function updateLargestSegmentId(largestSegmentId: number | null, actionTracingId: string) {
  return { name: "updateLargestSegmentId", value: { largestSegmentId, actionTracingId } } as const;
}

export function updateActiveSegmentId(activeSegmentId: number, actionTracingId: string) {
  return {
    name: "updateActiveSegmentId",
    value: {
      actionTracingId,
      activeSegmentId,
    },
  } as const;
}

// This action only exists for legacy reasons. Old annotations may have this
// action in the action log. Don't use it.
export function LEGACY_updateUserBoundingBoxesInSkeletonTracing(
  userBoundingBoxes: Array<UserBoundingBox>,
  actionTracingId: string,
) {
  return {
    name: "updateUserBoundingBoxesInSkeletonTracing",
    value: {
      actionTracingId,
      boundingBoxes: userBoundingBoxes.map((bbox) =>
        convertUserBoundingBoxFromFrontendToServer(bbox),
      ),
    },
  } as const;
}

// This action only exists for legacy reasons. Old annotations may have this
// action in the action log. Don't use it.
export function LEGACY_updateUserBoundingBoxesInVolumeTracing(
  userBoundingBoxes: Array<UserBoundingBox>,
  actionTracingId: string,
) {
  return {
    name: "updateUserBoundingBoxesInVolumeTracing",
    value: {
      actionTracingId,
      boundingBoxes: userBoundingBoxes.map((bbox) =>
        convertUserBoundingBoxFromFrontendToServer(bbox),
      ),
    },
  } as const;
}
export function addUserBoundingBoxInSkeletonTracing(
  boundingBox: UserBoundingBoxWithOptIsVisible,
  actionTracingId: string,
) {
  return {
    name: "addUserBoundingBoxInSkeletonTracing",
    value: {
      boundingBox: convertUserBoundingBoxFromFrontendToServer(boundingBox),
      actionTracingId,
    },
  } as const;
}

export function addUserBoundingBoxInVolumeTracing(
  boundingBox: UserBoundingBoxWithOptIsVisible,
  actionTracingId: string,
) {
  return {
    name: "addUserBoundingBoxInVolumeTracing",
    value: {
      boundingBox: convertUserBoundingBoxFromFrontendToServer(boundingBox),
      actionTracingId,
    },
  } as const;
}

export function updateUserBoundingBoxVisibilityInVolumeTracing(
  boundingBoxId: number,
  isVisible: boolean,
  actionTracingId: string,
) {
  return {
    name: "updateUserBoundingBoxVisibilityInVolumeTracing",
    value: { boundingBoxId, isVisible, actionTracingId },
  } as const;
}

export function deleteUserBoundingBoxInSkeletonTracing(
  boundingBoxId: number,
  actionTracingId: string,
) {
  return {
    name: "deleteUserBoundingBoxInSkeletonTracing",
    value: {
      boundingBoxId,
      actionTracingId,
    },
  } as const;
}

export function deleteUserBoundingBoxInVolumeTracing(
  boundingBoxId: number,
  actionTracingId: string,
) {
  return {
    name: "deleteUserBoundingBoxInVolumeTracing",
    value: {
      boundingBoxId,
      actionTracingId,
    },
  } as const;
}

function _updateUserBoundingBoxHelper(
  boundingBoxId: number,
  updatedProps: PartialBoundingBoxWithoutVisibility,
  actionTracingId: string,
): {
  boundingBoxId: number;
  actionTracingId: string;
  boundingBox?: BoundingBoxObject;
  name?: string;
  color?: Vector3;
} {
  const { boundingBox, ...rest } = updatedProps;
  const updatedPropsForServer =
    boundingBox != null
      ? { ...rest, boundingBox: Utils.computeBoundingBoxObjectFromBoundingBox(boundingBox) }
      : (updatedProps as Omit<PartialBoundingBoxWithoutVisibility, "boundingBox">);
  return {
    boundingBoxId,
    actionTracingId,
    ...updatedPropsForServer,
  };
}

export function updateUserBoundingBoxInVolumeTracing(
  boundingBoxId: number,
  updatedProps: PartialBoundingBoxWithoutVisibility,
  actionTracingId: string,
) {
  return {
    name: "updateUserBoundingBoxInVolumeTracing",
    value: _updateUserBoundingBoxHelper(boundingBoxId, updatedProps, actionTracingId),
  } as const;
}

export function updateUserBoundingBoxInSkeletonTracing(
  boundingBoxId: number,
  updatedProps: PartialBoundingBoxWithoutVisibility,
  actionTracingId: string,
) {
  return {
    name: "updateUserBoundingBoxInSkeletonTracing",
    value: _updateUserBoundingBoxHelper(boundingBoxId, updatedProps, actionTracingId),
  } as const;
}

export function updateUserBoundingBoxVisibilityInSkeletonTracing(
  boundingBoxId: number,
  isVisible: boolean,
  actionTracingId: string,
) {
  return {
    name: "updateUserBoundingBoxVisibilityInSkeletonTracing",
    value: {
      boundingBoxId,
      actionTracingId,
      isVisible,
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

export function updateSegmentVisibilityVolumeAction(
  id: number,
  isVisible: boolean,
  actionTracingId: string,
) {
  return {
    name: "updateSegmentVisibility",
    value: {
      id,
      actionTracingId,
      isVisible,
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
  if (base64Data == null) {
    throw new Error("Invalid updateBucket action.");
  }
  return {
    name: "updateBucket",
    value: {
      actionTracingId,
      ...bucketInfo,
      // The frontend should always send base64Data. However,
      // the return type of this function is also used for the
      // update actions that can be retrieved from the server.
      // In that case, the value will always be undefined.
      base64Data: base64Data as string | undefined,
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

export function updateSegmentGroupsExpandedState(
  groupIds: number[],
  areExpanded: boolean,
  actionTracingId: string,
) {
  return {
    name: "updateSegmentGroupsExpandedState",
    value: {
      actionTracingId,
      groupIds,
      areExpanded,
    },
  } as const;
}

export function updateTreeGroupsExpandedState(
  groupIds: number[],
  areExpanded: boolean,
  actionTracingId: string,
) {
  return {
    name: "updateTreeGroupsExpandedState",
    value: {
      actionTracingId,
      groupIds,
      areExpanded,
    },
  } as const;
}

export function updateSegmentGroupVisibilityVolumeAction(
  groupId: number | null,
  isVisible: boolean,
  actionTracingId: string,
) {
  return {
    name: "updateSegmentGroupVisibility",
    value: {
      actionTracingId,
      groupId,
      isVisible,
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
export function updateCameraAnnotation(
  editPosition: Vector3,
  editPositionAdditionalCoordinates: AdditionalCoordinate[] | null,
  editRotation: Vector3,
  zoomLevel: number,
) {
  return {
    name: "updateCamera",
    value: {
      editPosition,
      editRotation,
      zoomLevel,
      editPositionAdditionalCoordinates,
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
  segmentId1: NumberLike,
  segmentId2: NumberLike,
  agglomerateId: NumberLike,
  actionTracingId: string,
): {
  /*
   * Removes the edges between segmentId1 and segmentId2 that exist in the agglomerate graph.
   * If the edge removal leads to an actual split of the two agglomerates,
   * the agglomerate that belongs to segmentId1 will keep its agglomerate id.
   * The other agglomerate will be assigned a new id (largestAgglomerateId + 1).
   */
  name: "splitAgglomerate";
  value: {
    actionTracingId: string;
    segmentId1: number | undefined;
    segmentId2: number | undefined;
    // agglomerateId is needed in live collab setting to notice changes of loaded agglomerates done by other users.
    // Kept up-to-date in save queue by updateSaveQueueEntriesToStateAfterRebase saga.
    agglomerateId?: number | undefined;
    // For backwards compatibility reasons,
    // older segments are defined using their positions (and mag)
    // instead of their unmapped ids.
    segmentPosition1?: Vector3 | undefined;
    segmentPosition2?: Vector3 | undefined;
    mag?: Vector3; // Unused in back-end but may exist in older update actions
  };
} {
  return {
    name: "splitAgglomerate",
    value: {
      actionTracingId,
      // TODO: Proper 64 bit support (#6921)
      segmentId1: Number(segmentId1),
      segmentId2: Number(segmentId2),
      agglomerateId: Number(agglomerateId),
    },
  } as const;
}
export function mergeAgglomerate(
  segmentId1: NumberLike,
  segmentId2: NumberLike,
  agglomerateId1: NumberLike,
  agglomerateId2: NumberLike,
  actionTracingId: string,
): {
  /*
   * Merges the agglomerates that belong to segmentId1 and segmentId2.
   * The agglomerate that belongs to segmentId1 will keep its agglomerate id.
   */
  name: "mergeAgglomerate";
  value: {
    actionTracingId: string;
    segmentId1: number | undefined;
    segmentId2: number | undefined;
    // agglomerateId1 and agglomerateId2 are needed in live collab setting to notice changes of loaded agglomerates done by other users.
    // Kept up-to-date in save queue by updateSaveQueueEntriesToStateAfterRebase saga.
    agglomerateId1?: number;
    agglomerateId2?: number;
    // For backwards compatibility reasons,
    // older segments are defined using their positions (and mag)
    // instead of their unmapped ids.
    segmentPosition1?: Vector3 | undefined;
    segmentPosition2?: Vector3 | undefined;
    mag?: Vector3;
  };
} {
  return {
    name: "mergeAgglomerate",
    value: {
      actionTracingId,
      // TODO: Proper 64 bit support (#6921)
      segmentId1: Number(segmentId1),
      segmentId2: Number(segmentId2),
      agglomerateId1: Number(agglomerateId1),
      agglomerateId2: Number(agglomerateId2),
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
