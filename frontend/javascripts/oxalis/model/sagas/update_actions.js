// @flow
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

export type NodeWithTreeId = { treeId: number } & Node;

export type UpdateTreeUpdateAction = {|
  name: "createTree" | "updateTree",
  value: {|
    id: number,
    updatedId: ?number,
    color: Vector3,
    name: string,
    comments: Array<CommentType>,
    branchPoints: Array<BranchPoint>,
    groupId: ?number,
    timestamp: number,
    isVisible: boolean,
  |},
|};
export type DeleteTreeUpdateAction = {|
  name: "deleteTree",
  value: {| id: number |},
|};
type MoveTreeComponentUpdateAction = {|
  name: "moveTreeComponent",
  value: {|
    sourceId: number,
    targetId: number,
    nodeIds: Array<number>,
  |},
|};
type MergeTreeUpdateAction = {|
  name: "mergeTree",
  value: {|
    sourceId: number,
    targetId: number,
  |},
|};
export type CreateNodeUpdateAction = {|
  name: "createNode",
  value: NodeWithTreeId,
|};
type UpdateNodeUpdateAction = {|
  name: "updateNode",
  value: NodeWithTreeId,
|};
export type UpdateTreeVisibilityUpdateAction = {|
  name: "updateTreeVisibility",
  value: {|
    treeId: number,
    isVisible: boolean,
  |},
|};
type UpdateTreeGroupVisibilityUpdateAction = {|
  name: "updateTreeGroupVisibility",
  value: {|
    treeGroupId: ?number,
    isVisible: boolean,
  |},
|};
export type DeleteNodeUpdateAction = {|
  name: "deleteNode",
  value: {|
    treeId: number,
    nodeId: number,
  |},
|};
type CreateEdgeUpdateAction = {|
  name: "createEdge",
  value: {|
    treeId: number,
    source: number,
    target: number,
  |},
|};
type DeleteEdgeUpdateAction = {|
  name: "deleteEdge",
  value: {|
    treeId: number,
    source: number,
    target: number,
  |},
|};
export type UpdateSkeletonTracingUpdateAction = {|
  name: "updateTracing",
  value: {|
    activeNode: ?number,
    editPosition: Vector3,
    editRotation: Vector3,
    zoomLevel: number,
  |},
|};
type UpdateVolumeTracingUpdateAction = {|
  name: "updateTracing",
  value: {|
    activeSegmentId: number,
    editPosition: Vector3,
    editRotation: Vector3,
    largestSegmentId: number,
    zoomLevel: number,
  |},
|};
type UpdateUserBoundingBoxesAction = {|
  name: "updateUserBoundingBoxes",
  value: {|
    boundingBoxes: Array<UserBoundingBoxToServer>,
  |},
|};
type UpdateBucketUpdateAction = {|
  name: "updateBucket",
  value: SendBucketInfo & {
    base64Data: string,
  },
|};
type UpdateTreeGroupsUpdateAction = {|
  name: "updateTreeGroups",
  value: {|
    treeGroups: Array<TreeGroup>,
  |},
|};
export type RevertToVersionUpdateAction = {|
  name: "revertToVersion",
  value: {|
    sourceVersion: number,
  |},
|};
export type RemoveFallbackLayerAction = {|
  name: "removeFallbackLayer",
  value: {},
|};

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
  | UpdateUserBoundingBoxesAction
  | UpdateBucketUpdateAction
  | UpdateTreeVisibilityUpdateAction
  | UpdateTreeGroupVisibilityUpdateAction
  | RevertToVersionUpdateAction
  | UpdateTreeGroupsUpdateAction
  | RemoveFallbackLayerAction;

// This update action is only created in the frontend for display purposes
type CreateTracingUpdateAction = {|
  name: "createTracing",
  value: {||},
|};

type AddServerValuesFn = <T>(
  T,
) => {
  ...T,
  value: { ...$PropertyType<T, "value">, actionTimestamp: number },
};
type AsServerAction<A> = $Call<AddServerValuesFn, A>;

// Since flow does not provide ways to perform type transformations on the
// single parts of a union, we need to write this out manually.
export type ServerUpdateAction =
  | AsServerAction<UpdateTreeUpdateAction>
  | AsServerAction<DeleteTreeUpdateAction>
  | AsServerAction<MergeTreeUpdateAction>
  | AsServerAction<MoveTreeComponentUpdateAction>
  | AsServerAction<CreateNodeUpdateAction>
  | AsServerAction<UpdateNodeUpdateAction>
  | AsServerAction<DeleteNodeUpdateAction>
  | AsServerAction<CreateEdgeUpdateAction>
  | AsServerAction<DeleteEdgeUpdateAction>
  | AsServerAction<UpdateSkeletonTracingUpdateAction>
  | AsServerAction<UpdateVolumeTracingUpdateAction>
  | AsServerAction<UpdateUserBoundingBoxesAction>
  | AsServerAction<UpdateBucketUpdateAction>
  | AsServerAction<UpdateTreeVisibilityUpdateAction>
  | AsServerAction<UpdateTreeGroupVisibilityUpdateAction>
  | AsServerAction<RevertToVersionUpdateAction>
  | AsServerAction<UpdateTreeGroupsUpdateAction>
  | AsServerAction<CreateTracingUpdateAction>
  | AsServerAction<RemoveFallbackLayerAction>;

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
  groupId: ?number,
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
    value: Object.assign({}, node, { treeId }),
  };
}
export function updateNode(treeId: number, node: Node): UpdateNodeUpdateAction {
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
  tracing: { activeNodeId: ?number },
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
): UpdateUserBoundingBoxesAction {
  return {
    name: "updateUserBoundingBoxes",
    value: {
      boundingBoxes: convertUserBoundingBoxesFromFrontendToServer(userBoundingBoxes),
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

export function removeFallbackLayer(): RemoveFallbackLayerAction {
  return {
    name: "removeFallbackLayer",
    value: {},
  };
}

export function serverCreateTracing(timestamp: number) {
  return {
    name: "createTracing",
    value: { actionTimestamp: timestamp },
  };
}
