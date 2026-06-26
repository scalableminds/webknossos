import type { Key } from "react";
import { batchActions } from "redux-batched-actions";
import type {
  AdditionalCoordinate,
  MetadataEntryProto,
  ServerSkeletonTracing,
} from "types/api_types";
import type { TreeType, Vector3 } from "viewer/constants";
import {
  type AddNewUserBoundingBox,
  AllUserBoundingBoxActions,
} from "viewer/model/actions/annotation_actions";
import type { MutableTreeMap, Tree, TreeGroup } from "viewer/model/types/tree_types";
import type { SkeletonTracing } from "viewer/store";
import type { ApplicableSkeletonServerUpdateAction } from "../sagas/volume/update_actions";

export type InitializeSkeletonTracingAction = ReturnType<typeof initializeSkeletonTracingAction>;
export type CreateNodeAction = ReturnType<typeof createNodeAction>;
export type DeleteNodeAction = ReturnType<typeof deleteNodeAction>;
export type DeleteEdgeAction = ReturnType<typeof deleteEdgeAction>;
type SetActiveNodeAction = ReturnType<typeof setActiveNodeAction>;
type CenterActiveNodeAction = ReturnType<typeof centerActiveNodeAction>;
type SetNodeRadiusAction = ReturnType<typeof setNodeRadiusAction>;
export type SetNodePositionAction = ReturnType<typeof setNodePositionAction>;
type CreateBranchPointAction = ReturnType<typeof createBranchPointAction>;
type DeleteBranchPointAction = ReturnType<typeof deleteBranchPointAction>;
type DeleteBranchpointByIdAction = ReturnType<typeof deleteBranchpointByIdAction>;
type ToggleTreeAction = ReturnType<typeof toggleTreeAction>;
type SetTreeVisibilityAction = ReturnType<typeof setTreeVisibilityAction>;
type SetExpandedTreeGroupsByKeysAction = ReturnType<typeof setExpandedTreeGroupsByKeysAction>;
type SetExpandedTreeGroupsByIdsAction = ReturnType<typeof setExpandedTreeGroupsByIdsAction>;
type ExpandParentGroupsOfTreeAction = ReturnType<typeof expandParentGroupsOfTreeAction>;
type FocusTreeAction = ReturnType<typeof focusTreeAction>;
type ToggleAllTreesAction = ReturnType<typeof toggleAllTreesAction>;
type ToggleInactiveTreesAction = ReturnType<typeof toggleInactiveTreesAction>;
type ToggleTreeGroupAction = ReturnType<typeof toggleTreeGroupAction>;
type RequestDeleteBranchPointAction = ReturnType<typeof requestDeleteBranchPointAction>;
type CreateTreeAction = ReturnType<typeof createTreeAction>;
type SetEdgeVisibilityAction = ReturnType<typeof setTreeEdgeVisibilityAction>;
type AddTreesAndGroupsAction = ReturnType<typeof addTreesAndGroupsAction>;
export type DeleteTreeAction = ReturnType<typeof deleteTreeAction>;
type DeleteTreesAction = ReturnType<typeof deleteTreesAction>;
type ResetSkeletonTracingAction = ReturnType<typeof resetSkeletonTracingAction>;
type SetActiveTreeAction = ReturnType<typeof setActiveTreeAction>;
type SetActiveTreeByNameAction = ReturnType<typeof setActiveTreeByNameAction>;
type DeselectActiveTreeAction = ReturnType<typeof deselectActiveTreeAction>;
type SetActiveTreeGroupAction = ReturnType<typeof setActiveTreeGroupAction>;
type DeselectActiveTreeGroupAction = ReturnType<typeof deselectActiveTreeGroupAction>;
export type MergeTreesAction = ReturnType<typeof mergeTreesAction>;
type SetTreeNameAction = ReturnType<typeof setTreeNameAction>;
type SetTreeMetadataAction = ReturnType<typeof setTreeMetadataAction>;
type SetTreeAgglomerateIdAction = ReturnType<typeof setTreeAgglomerateInfoIdAction>;
type SetTreesAgglomerateInfoTracingIdAction = ReturnType<
  typeof setTreesAgglomerateInfoTracingIdAction
>;
type SelectNextTreeAction = ReturnType<typeof selectNextTreeAction>;
type SetTreeColorIndexAction = ReturnType<typeof setTreeColorIndexAction>;
type ShuffleTreeColorAction = ReturnType<typeof shuffleTreeColorAction>;
type SetTreeColorAction = ReturnType<typeof setTreeColorAction>;
type ShuffleAllTreeColorsAction = ReturnType<typeof shuffleAllTreeColorsAction>;
type SetTreeTypeAction = ReturnType<typeof setTreeTypeAction>;
type CreateCommentAction = ReturnType<typeof createCommentAction>;
type DeleteCommentAction = ReturnType<typeof deleteCommentAction>;
type SetSkeletonTracingAction = ReturnType<typeof setSkeletonTracingAction>;
type SetTreeGroupsAction = ReturnType<typeof setTreeGroupsAction>;
type SetTreeGroupAction = ReturnType<typeof setTreeGroupAction>;
type SetShowSkeletonsAction = ReturnType<typeof setShowSkeletonsAction>;
type SetMergerModeEnabledAction = ReturnType<typeof setMergerModeEnabledAction>;
type UpdateNavigationListAction = ReturnType<typeof updateNavigationListAction>;
type ApplySkeletonUpdateActionsFromServerAction = ReturnType<
  typeof applySkeletonUpdateActionsFromServerAction
>;
export type LoadAgglomerateTreeFromIdAction = ReturnType<typeof loadAgglomerateTreeFromIdAction>;
export type LoadAgglomerateTreeAtPositionAction = ReturnType<
  typeof loadAgglomerateTreeAtPositionAction
>;
export type NoAction = ReturnType<typeof noAction>;

export type BatchableUpdateTreeAction =
  | SetTreeGroupAction
  | DeleteTreeAction
  | DeleteTreesAction
  | SetTreeGroupsAction;
type BatchUpdateGroupsAndTreesAction = {
  type: "BATCH_UPDATE_GROUPS_AND_TREES";
  payload: BatchableUpdateTreeAction[];
  meta: {
    batch: true;
  };
};

export type SkeletonTracingAction =
  | InitializeSkeletonTracingAction
  | CreateNodeAction
  | DeleteNodeAction
  | DeleteEdgeAction
  | SetActiveNodeAction
  | CenterActiveNodeAction
  | SetActiveTreeGroupAction
  | DeselectActiveTreeGroupAction
  | SetNodeRadiusAction
  | SetNodePositionAction
  | CreateBranchPointAction
  | DeleteBranchPointAction
  | DeleteBranchpointByIdAction
  | RequestDeleteBranchPointAction
  | CreateTreeAction
  | SetEdgeVisibilityAction
  | AddTreesAndGroupsAction
  | DeleteTreeAction
  | DeleteTreesAction
  | ResetSkeletonTracingAction
  | SetActiveTreeAction
  | SetActiveTreeByNameAction
  | DeselectActiveTreeAction
  | MergeTreesAction
  | SetTreeNameAction
  | SetTreeMetadataAction
  | SetTreeAgglomerateIdAction
  | SetTreesAgglomerateInfoTracingIdAction
  | SelectNextTreeAction
  | SetTreeColorAction
  | SetTreeTypeAction
  | ShuffleTreeColorAction
  | ShuffleAllTreeColorsAction
  | SetTreeColorIndexAction
  | CreateCommentAction
  | DeleteCommentAction
  | ToggleTreeAction
  | ToggleAllTreesAction
  | SetTreeVisibilityAction
  | SetExpandedTreeGroupsByKeysAction
  | SetExpandedTreeGroupsByIdsAction
  | ExpandParentGroupsOfTreeAction
  | FocusTreeAction
  | ToggleInactiveTreesAction
  | ToggleTreeGroupAction
  | NoAction
  | SetSkeletonTracingAction
  | SetTreeGroupsAction
  | SetTreeGroupAction
  | SetShowSkeletonsAction
  | SetMergerModeEnabledAction
  | UpdateNavigationListAction
  | LoadAgglomerateTreeFromIdAction
  | LoadAgglomerateTreeAtPositionAction
  | ApplySkeletonUpdateActionsFromServerAction
  | AddNewUserBoundingBox;

// Declarative policy for each skeleton action, used as the single source of truth for the skeleton
// reducer's permission handling. See `skeletonActionPolicies` below.
// - `needsUpdatePermission: false` => the action is applied regardless of update permissions
//   (view/selection state, initialization, server-applied updates). The collaboration mode is
//   irrelevant for these, hence no `collab` field.
// - `needsUpdatePermission: true` => the action mutates the annotation and is only applied when
//   updating is currently allowed. The `collab` field additionally decides whether it may run in
//   concurrent collaboration ("live collaboration") mode:
//     - "block": never allowed in concurrent mode.
//     - "allow": always allowed (only ever touches agglomerate trees anyway).
//     - "onlyAgglomerateTree": allowed only if the affected tree(s) are agglomerate trees
//       (i.e. proofreading). The affected trees are resolved at runtime in the reducer.
export type SkeletonActionPolicy =
  | { needsUpdatePermission: false }
  | { needsUpdatePermission: true; collab: "block" | "allow" | "onlyAgglomerateTree" };

export const skeletonActionPolicies: Record<SkeletonTracingAction["type"], SkeletonActionPolicy> = {
  // Initialization / server-applied updates / view & selection state. Applied unconditionally.
  INITIALIZE_SKELETONTRACING: { needsUpdatePermission: false },
  APPLY_SKELETON_UPDATE_ACTIONS_FROM_SERVER: { needsUpdatePermission: false },
  SET_ACTIVE_NODE: { needsUpdatePermission: false },
  CENTER_ACTIVE_NODE: { needsUpdatePermission: false },
  SET_NODE_RADIUS: { needsUpdatePermission: false },
  REQUEST_DELETE_BRANCHPOINT: { needsUpdatePermission: false },
  SET_ACTIVE_TREE: { needsUpdatePermission: false },
  SET_ACTIVE_TREE_BY_NAME: { needsUpdatePermission: false },
  DESELECT_ACTIVE_TREE: { needsUpdatePermission: false },
  SET_TREE_ACTIVE_GROUP: { needsUpdatePermission: false },
  DESELECT_ACTIVE_TREE_GROUP: { needsUpdatePermission: false },
  SELECT_NEXT_TREE: { needsUpdatePermission: false },
  SET_TREE_COLOR: { needsUpdatePermission: false },
  SET_TREE_COLOR_INDEX: { needsUpdatePermission: false },
  SET_TREE_TYPE: { needsUpdatePermission: false },
  SHUFFLE_TREE_COLOR: { needsUpdatePermission: false },
  SHUFFLE_ALL_TREE_COLORS: { needsUpdatePermission: false },
  TOGGLE_TREE: { needsUpdatePermission: false },
  TOGGLE_ALL_TREES: { needsUpdatePermission: false },
  TOGGLE_INACTIVE_TREES: { needsUpdatePermission: false },
  TOGGLE_TREE_GROUP: { needsUpdatePermission: false },
  SET_TREE_VISIBILITY: { needsUpdatePermission: false },
  SET_EXPANDED_TREE_GROUPS_BY_KEYS: { needsUpdatePermission: false },
  SET_EXPANDED_TREE_GROUPS_BY_IDS: { needsUpdatePermission: false },
  EXPAND_PARENT_GROUPS_OF_TREE: { needsUpdatePermission: false },
  FOCUS_TREE: { needsUpdatePermission: false },
  SET_SKELETON_TRACING: { needsUpdatePermission: false },
  SET_SHOW_SKELETONS: { needsUpdatePermission: false },
  SET_MERGER_MODE_ENABLED: { needsUpdatePermission: false },
  UPDATE_NAVIGATION_LIST: { needsUpdatePermission: false },
  LOAD_AGGLOMERATE_TREE_FROM_ID: { needsUpdatePermission: false },
  LOAD_AGGLOMERATE_TREE_AT_POSITION: { needsUpdatePermission: false },
  ADD_NEW_USER_BOUNDING_BOX: { needsUpdatePermission: false },
  NONE: { needsUpdatePermission: false },

  // Mutations that are never allowed in concurrent collaboration mode.
  CREATE_NODE: { needsUpdatePermission: true, collab: "block" },
  DELETE_NODE: { needsUpdatePermission: true, collab: "block" },
  SET_NODE_POSITION: { needsUpdatePermission: true, collab: "block" },
  CREATE_BRANCHPOINT: { needsUpdatePermission: true, collab: "block" },
  DELETE_BRANCHPOINT: { needsUpdatePermission: true, collab: "block" },
  DELETE_BRANCHPOINT_BY_ID: { needsUpdatePermission: true, collab: "block" },
  CREATE_COMMENT: { needsUpdatePermission: true, collab: "block" },
  DELETE_COMMENT: { needsUpdatePermission: true, collab: "block" },
  CREATE_TREE: { needsUpdatePermission: true, collab: "block" },
  RESET_SKELETON_TRACING: { needsUpdatePermission: true, collab: "block" },
  SET_TREE_GROUPS: { needsUpdatePermission: true, collab: "block" },

  // Only ever touches agglomerate trees, so it is safe in concurrent collaboration mode.
  SET_TREES_AGGLOMERATE_INFO_TRACING_ID: { needsUpdatePermission: true, collab: "allow" },

  // Mutations allowed in concurrent collaboration mode only when the affected tree is agglomerate.
  DELETE_EDGE: { needsUpdatePermission: true, collab: "onlyAgglomerateTree" },
  MERGE_TREES: { needsUpdatePermission: true, collab: "onlyAgglomerateTree" },
  ADD_TREES_AND_GROUPS: { needsUpdatePermission: true, collab: "onlyAgglomerateTree" },
  DELETE_TREE: { needsUpdatePermission: true, collab: "onlyAgglomerateTree" },
  DELETE_TREES: { needsUpdatePermission: true, collab: "onlyAgglomerateTree" },
  SET_TREE_NAME: { needsUpdatePermission: true, collab: "onlyAgglomerateTree" },
  SET_TREE_METADATA: { needsUpdatePermission: true, collab: "onlyAgglomerateTree" },
  SET_TREE_AGGLOMERATE_INFO_ID: { needsUpdatePermission: true, collab: "onlyAgglomerateTree" },
  SET_EDGES_ARE_VISIBLE: { needsUpdatePermission: true, collab: "onlyAgglomerateTree" },
  SET_TREE_GROUP: { needsUpdatePermission: true, collab: "onlyAgglomerateTree" },
};

export const SkeletonTracingSaveRelevantActions = [
  "INITIALIZE_SKELETONTRACING",
  "INITIALIZE_ANNOTATION_WITH_TRACINGS",
  "CREATE_NODE",
  "DELETE_NODE",
  "DELETE_EDGE",
  "SET_ACTIVE_NODE",
  "SET_NODE_RADIUS",
  "SET_NODE_POSITION",
  "CREATE_BRANCHPOINT",
  "DELETE_BRANCHPOINT_BY_ID",
  "DELETE_BRANCHPOINT",
  "CREATE_TREE",
  "SET_EDGES_ARE_VISIBLE",
  "ADD_TREES_AND_GROUPS",
  "DELETE_TREE",
  "DELETE_TREES",
  "SET_ACTIVE_TREE",
  "SET_ACTIVE_TREE_BY_NAME",
  "SET_TREE_NAME",
  "SET_TREE_AGGLOMERATE_INFO_ID",
  "SET_TREES_AGGLOMERATE_INFO_TRACING_ID",
  "SET_TREE_METADATA",
  "MERGE_TREES",
  "SELECT_NEXT_TREE",
  "SHUFFLE_TREE_COLOR",
  "SHUFFLE_ALL_TREE_COLORS",
  "SET_TREE_TYPE",
  "CREATE_COMMENT",
  "DELETE_COMMENT",
  "SET_TREE_GROUPS",
  "SET_EXPANDED_TREE_GROUPS_BY_KEYS",
  "SET_EXPANDED_TREE_GROUPS_BY_IDS",
  "SET_TREE_GROUP",
  "SET_MERGER_MODE_ENABLED",
  "TOGGLE_TREE",
  "TOGGLE_TREE_GROUP",
  "TOGGLE_ALL_TREES",
  "TOGGLE_INACTIVE_TREES",
  "SET_TREE_COLOR",
  "BATCH_UPDATE_GROUPS_AND_TREES", // Composited actions, only dispatched using `batchActions`
  ...AllUserBoundingBoxActions,
];

export const noAction = () =>
  ({
    type: "NONE",
  }) as const;

export const initializeSkeletonTracingAction = (tracing: ServerSkeletonTracing) =>
  ({
    type: "INITIALIZE_SKELETONTRACING",
    tracing,
  }) as const;

export const createNodeAction = (
  // Note that this position should not have any
  // transformations applied. This is the value that
  // will be stored in the back-end and on which potential
  // transformations will be applied.
  position: Vector3,
  additionalCoordinates: AdditionalCoordinate[] | null,
  rotation: Vector3,
  viewport: number,
  mag: number,
  treeId?: number | null | undefined,
  dontActivate: boolean = false,
  timestamp: number = Date.now(),
) =>
  ({
    type: "CREATE_NODE",
    position,
    additionalCoordinates,
    rotation,
    viewport,
    mag,
    treeId,
    dontActivate,
    timestamp,
  }) as const;

export const deleteNodeAction = (
  nodeId?: number,
  treeId?: number,
  timestamp: number = Date.now(),
) =>
  ({
    type: "DELETE_NODE",
    nodeId,
    treeId,
    timestamp,
  }) as const;

export const deleteEdgeAction = (
  sourceNodeId: number,
  targetNodeId: number,
  timestamp: number = Date.now(),
  initiator: "PROOFREADING" | "USER" = "USER",
) =>
  ({
    type: "DELETE_EDGE",
    sourceNodeId,
    targetNodeId,
    timestamp,
    initiator,
  }) as const;

export const setActiveNodeAction = (
  nodeId: number | null,
  suppressAnimation: boolean = false,
  suppressCentering: boolean = false,
  suppressRotation?: boolean,
) =>
  ({
    type: "SET_ACTIVE_NODE",
    nodeId,
    suppressAnimation,
    suppressCentering,
    suppressRotation,
  }) as const;

export const centerActiveNodeAction = (suppressAnimation: boolean = false) =>
  ({
    type: "CENTER_ACTIVE_NODE",
    suppressAnimation,
  }) as const;

export const setNodeRadiusAction = (radius: number, nodeId?: number, treeId?: number) =>
  ({
    type: "SET_NODE_RADIUS",
    radius,
    nodeId,
    treeId,
  }) as const;

export const setNodePositionAction = (position: Vector3, nodeId?: number, treeId?: number) =>
  ({
    type: "SET_NODE_POSITION",
    position,
    nodeId,
    treeId,
  }) as const;

export const createBranchPointAction = (
  nodeId?: number,
  treeId?: number,
  timestamp: number = Date.now(),
) =>
  ({
    type: "CREATE_BRANCHPOINT",
    nodeId,
    treeId,
    timestamp,
  }) as const;

export const deleteBranchPointAction = () =>
  ({
    type: "DELETE_BRANCHPOINT",
  }) as const;

export const deleteBranchpointByIdAction = (nodeId: number, treeId: number) =>
  ({
    type: "DELETE_BRANCHPOINT_BY_ID",
    nodeId,
    treeId,
  }) as const;

export const requestDeleteBranchPointAction = () =>
  ({
    type: "REQUEST_DELETE_BRANCHPOINT",
  }) as const;

export const createTreeAction = (
  // If the tree creation is about to succeed, this callback
  // will be triggered with the id that will be assigned.
  treeIdCallback?: (id: number) => void,
  timestamp: number = Date.now(),
) =>
  ({
    type: "CREATE_TREE",
    treeIdCallback,
    timestamp,
  }) as const;

export const setTreeEdgeVisibilityAction = (
  treeId: number | null | undefined,
  edgesAreVisible: boolean,
) =>
  ({
    type: "SET_EDGES_ARE_VISIBLE",
    treeId,
    edgesAreVisible,
  }) as const;

export const addTreesAndGroupsAction = (
  trees: MutableTreeMap,
  treeGroups: Array<TreeGroup> | null | undefined,
  treeIdsCallback: ((ids: number[]) => void) | undefined = undefined,
  assignTreeToNewGroupId: boolean = true,
) =>
  // If assignTreeToNewGroupId is false, the given group id of a tree will be kept. This is useful
  // when trees are duplicated, as the copied tree should be in the same group as the original tree.
  // If assignTreeToNewGroupId is true, the tree will be assigned to a new group id, as the original
  // group id might already be used by another group.
  ({
    type: "ADD_TREES_AND_GROUPS",
    trees,
    treeGroups: treeGroups || [],
    treeIdsCallback,
    assignNewGroupId: assignTreeToNewGroupId,
  }) as const;

export const deleteTreeAction = (treeId?: number, suppressActivatingNextNode: boolean = false) =>
  // If suppressActivatingNextNode is true, the tree will be deleted without activating
  // another node (nor tree). Use this in cases where you want to avoid changing
  // the active position (due to the auto-centering). One could also suppress the auto-centering
  // behavior, but the semantics of changing the active node might also be confusing to the user
  // (e.g., when proofreading). So, it might be clearer to not have an active node in the first
  // place.
  ({
    type: "DELETE_TREE",
    treeId,
    suppressActivatingNextNode,
  }) as const;

export const deleteTreesAction = (treeIds: number[], suppressActivatingNextNode: boolean = false) =>
  // If suppressActivatingNextNode is true, the trees will be deleted without activating
  // another node (nor tree). Use this in cases where you want to avoid changing
  // the active position (due to the auto-centering). One could also suppress the auto-centering
  // behavior, but the semantics of changing the active node might also be confusing to the user
  // (e.g., when proofreading). So, it might be clearer to not have an active node in the first
  // place.
  ({
    type: "DELETE_TREES",
    treeIds,
    suppressActivatingNextNode,
  }) as const;

export const resetSkeletonTracingAction = () =>
  ({
    type: "RESET_SKELETON_TRACING",
  }) as const;

export const toggleTreeAction = (
  treeId: number | null | undefined,
  timestamp: number = Date.now(),
) =>
  ({
    type: "TOGGLE_TREE",
    treeId,
    timestamp,
  }) as const;

export const setExpandedTreeGroupsByKeysAction = (expandedGroups: Set<Key>) =>
  ({
    type: "SET_EXPANDED_TREE_GROUPS_BY_KEYS",
    expandedGroups,
  }) as const;

export const setExpandedTreeGroupsByIdsAction = (expandedGroups: Set<number>) =>
  ({
    type: "SET_EXPANDED_TREE_GROUPS_BY_IDS",
    expandedGroups,
  }) as const;

export const expandParentGroupsOfTreeAction = (tree: Tree) =>
  ({
    type: "EXPAND_PARENT_GROUPS_OF_TREE",
    tree,
  }) as const;

export const focusTreeAction = (tree: Tree) =>
  ({
    type: "FOCUS_TREE",
    tree,
  }) as const;

export const setTreeVisibilityAction = (treeId: number | null | undefined, isVisible: boolean) =>
  ({
    type: "SET_TREE_VISIBILITY",
    treeId,
    isVisible,
  }) as const;

export const toggleAllTreesAction = (timestamp: number = Date.now()) =>
  ({
    type: "TOGGLE_ALL_TREES",
    timestamp,
  }) as const;

export const toggleInactiveTreesAction = (timestamp: number = Date.now()) =>
  ({
    type: "TOGGLE_INACTIVE_TREES",
    timestamp,
  }) as const;

export const toggleTreeGroupAction = (groupId: number) =>
  ({
    type: "TOGGLE_TREE_GROUP",
    groupId,
  }) as const;

export const setActiveTreeAction = (treeId: number) =>
  ({
    type: "SET_ACTIVE_TREE",
    treeId,
  }) as const;

export const setActiveTreeByNameAction = (treeName: string) =>
  ({
    type: "SET_ACTIVE_TREE_BY_NAME",
    treeName,
  }) as const;

export const deselectActiveTreeAction = () =>
  ({
    type: "DESELECT_ACTIVE_TREE",
  }) as const;

export const setActiveTreeGroupAction = (groupId: number) =>
  ({
    type: "SET_TREE_ACTIVE_GROUP",
    groupId,
  }) as const;

export const deselectActiveTreeGroupAction = () =>
  ({
    type: "DESELECT_ACTIVE_TREE_GROUP",
  }) as const;

export const mergeTreesAction = (
  sourceNodeId: number,
  targetNodeId: number,
  initiator: "PROOFREADING" | "USER" = "USER",
) =>
  ({
    type: "MERGE_TREES",
    sourceNodeId,
    targetNodeId,
    initiator,
  }) as const;

export const setTreeNameAction = (
  name: string | undefined | null = null,
  treeId?: number | null | undefined,
) =>
  ({
    type: "SET_TREE_NAME",
    name,
    treeId,
  }) as const;

export const setTreeMetadataAction = (
  metadata: MetadataEntryProto[],
  treeId?: number | null | undefined,
) =>
  ({
    type: "SET_TREE_METADATA",
    metadata,
    treeId,
  }) as const;

export const setTreeAgglomerateInfoIdAction = (agglomerateId: number, treeId: number) =>
  ({
    type: "SET_TREE_AGGLOMERATE_INFO_ID",
    agglomerateId,
    treeId,
  }) as const;

export const setTreesAgglomerateInfoTracingIdAction = (newAgglomerateMappingTracingId: string) =>
  ({
    type: "SET_TREES_AGGLOMERATE_INFO_TRACING_ID",
    newAgglomerateMappingTracingId,
  }) as const;

export const selectNextTreeAction = (forward: boolean | null | undefined = true) =>
  ({
    type: "SELECT_NEXT_TREE",
    forward,
  }) as const;

export const setTreeColorIndexAction = (treeId: number | null | undefined, colorIndex: number) =>
  ({
    type: "SET_TREE_COLOR_INDEX",
    treeId,
    colorIndex,
  }) as const;

export const shuffleTreeColorAction = (treeId: number) =>
  ({
    type: "SHUFFLE_TREE_COLOR",
    treeId,
  }) as const;

export const setTreeColorAction = (treeId: number, color: Vector3) =>
  ({
    type: "SET_TREE_COLOR",
    treeId,
    color,
  }) as const;

export const shuffleAllTreeColorsAction = () =>
  ({
    type: "SHUFFLE_ALL_TREE_COLORS",
  }) as const;

export const setTreeTypeAction = (treeId: number, treeType: TreeType) =>
  ({
    type: "SET_TREE_TYPE",
    treeId,
    treeType,
  }) as const;

export const createCommentAction = (commentText: string, nodeId?: number, treeId?: number) =>
  ({
    type: "CREATE_COMMENT",
    commentText,
    nodeId,
    treeId,
  }) as const;

export const deleteCommentAction = (nodeId?: number, treeId?: number) =>
  ({
    type: "DELETE_COMMENT",
    nodeId,
    treeId,
  }) as const;

export const setSkeletonTracingAction = (tracing: SkeletonTracing) =>
  ({
    type: "SET_SKELETON_TRACING",
    tracing,
  }) as const;

export const setTreeGroupsAction = (treeGroups: Array<TreeGroup>) =>
  ({
    type: "SET_TREE_GROUPS",
    treeGroups,
  }) as const;

export const setTreeGroupAction = (groupId: number | null | undefined, treeId?: number) =>
  ({
    type: "SET_TREE_GROUP",
    groupId,
    treeId,
  }) as const;

export const setShowSkeletonsAction = (showSkeletons: boolean) =>
  ({
    type: "SET_SHOW_SKELETONS",
    showSkeletons,
  }) as const;

export const setMergerModeEnabledAction = (active: boolean) =>
  ({
    type: "SET_MERGER_MODE_ENABLED",
    active,
  }) as const;

export const updateNavigationListAction = (list: Array<number>, activeIndex: number) =>
  ({
    type: "UPDATE_NAVIGATION_LIST",
    list,
    activeIndex,
  }) as const;

export const applySkeletonUpdateActionsFromServerAction = (
  actions: Array<ApplicableSkeletonServerUpdateAction>,
  ignoreUnsupportedActionTypes: boolean = false,
) =>
  ({
    type: "APPLY_SKELETON_UPDATE_ACTIONS_FROM_SERVER",
    actions,
    ignoreUnsupportedActionTypes,
  }) as const;

// loadAgglomerateTreeAtPositionAction should always be preferred over loadAgglomerateTreeFromIdAction.
// It uses the position to derive the agglomerate id instead of the the id itself directly.
// The benefit of passing the position is that this allows to first synchronize with the newest version of the annotation
// in live-collab mode and then once up-to-date get the latest agglomerate id of the position.
// Otherwise, if the id is passed to the action, the syncing with the backend might update the id which is requested by this action via e.g. an merge operation.
// This would lead to the agglomerate id not existing anymore and thus the frontend requesting an agglomerate tree with an outdated agglomerate id.

// loadAgglomerateTreeFromIdAction only exists to keep supporting the frontend api function and
// initially loading the agglomerate tree stored in the URL during annotation loading.
export const loadAgglomerateTreeAtPositionAction = (
  layerName: string,
  mappingName: string,
  agglomeratePosition: Vector3,
) =>
  ({
    type: "LOAD_AGGLOMERATE_TREE_AT_POSITION",
    layerName,
    mappingName,
    agglomeratePosition,
  }) as const;

// Is unsafe in live collab-scenario. It is only save in case the mutex has been acquired, the annotation is in sync with the server
// and the latest mapping info was used to determine the passed agglomerate id.
// Currently, only exists for legacy support: initial agglomerate tree loading via URL and old frontend api function.
export const loadAgglomerateTreeFromIdAction = (
  layerName: string,
  mappingName: string,
  agglomerateId: number,
) =>
  ({
    type: "LOAD_AGGLOMERATE_TREE_FROM_ID",
    layerName,
    mappingName,
    agglomerateId,
  }) as const;

export const batchUpdateGroupsAndTreesAction = (actions: BatchableUpdateTreeAction[]) =>
  batchActions(
    actions,
    "BATCH_UPDATE_GROUPS_AND_TREES",
  ) as unknown as BatchUpdateGroupsAndTreesAction;
