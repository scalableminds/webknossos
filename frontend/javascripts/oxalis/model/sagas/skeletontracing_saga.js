// @flow
import { Modal } from "antd";
import _ from "lodash";

import type { Action } from "oxalis/model/actions/actions";
import {
  type Saga,
  _actionChannel,
  _take,
  _takeEvery,
  _throttle,
  call,
  fork,
  put,
  race,
  select,
  take,
} from "oxalis/model/sagas/effect-generators";
import {
  type UpdateAction,
  createEdge,
  createNode,
  createTree,
  deleteEdge,
  deleteNode,
  deleteTree,
  updateTreeVisibility,
  updateNode,
  updateSkeletonTracing,
  updateUserBoundingBoxes,
  updateTree,
  updateTreeGroups,
} from "oxalis/model/sagas/update_actions";
import { V3 } from "libs/mjs";
import {
  deleteBranchPointAction,
  setTreeNameAction,
  addTreesAndGroupsAction,
  type LoadAgglomerateSkeletonAction,
  deleteTreeAction,
} from "oxalis/model/actions/skeletontracing_actions";
import {
  generateTreeName,
  createMutableTreeMapFromTreeArray,
} from "oxalis/model/reducers/skeletontracing_reducer_helpers";
import {
  getActiveNode,
  getBranchPoints,
  enforceSkeletonTracing,
} from "oxalis/model/accessors/skeletontracing_accessor";
import { getPosition, getRotation } from "oxalis/model/accessors/flycam_accessor";
import { setPositionAction, setRotationAction } from "oxalis/model/actions/flycam_actions";
import { setVersionRestoreVisibilityAction } from "oxalis/model/actions/ui_actions";
import DiffableMap, { diffDiffableMaps } from "libs/diffable_map";
import EdgeCollection, { diffEdgeCollections } from "oxalis/model/edge_collection";
import ErrorHandling from "libs/error_handling";
import Store, {
  type Flycam,
  type Node,
  type NodeMap,
  type OxalisState,
  type SkeletonTracing,
  type Tree,
  type TreeMap,
} from "oxalis/store";
import Toast from "libs/toast";
import * as Utils from "libs/utils";
import api from "oxalis/api/internal_api";
import messages from "messages";
import { getLayerByName } from "oxalis/model/accessors/dataset_accessor";
import { getAgglomerateSkeleton } from "admin/admin_rest_api";
import { parseProtoTracing } from "oxalis/model/helpers/proto_helpers";
import createProgressCallback from "libs/progress_callback";
import {
  addConnectomeTreeAction,
  deleteConnectomeTreeAction,
} from "oxalis/model/actions/connectome_actions";

function* centerActiveNode(action: Action): Saga<void> {
  if (["DELETE_NODE", "DELETE_BRANCHPOINT"].includes(action.type)) {
    const centerNewNode = yield* select(
      (state: OxalisState) => state.userConfiguration.centerNewNode,
    );
    if (!centerNewNode) {
      // The active node should not be centered upon node manipulation.
      return;
    }
  }

  getActiveNode(yield* select((state: OxalisState) => enforceSkeletonTracing(state.tracing))).map(
    activeNode => {
      if (action.suppressAnimation === true) {
        Store.dispatch(setPositionAction(activeNode.position));
        Store.dispatch(setRotationAction(activeNode.rotation));
      } else {
        api.tracing.centerPositionAnimated(activeNode.position, false, activeNode.rotation);
      }
    },
  );
}

function* watchBranchPointDeletion(): Saga<void> {
  let lastActionCreatedNode = true;
  while (true) {
    const { deleteBranchpointAction } = yield* race({
      deleteBranchpointAction: _take("REQUEST_DELETE_BRANCHPOINT"),
      createNodeAction: _take("CREATE_NODE"),
    });

    if (deleteBranchpointAction) {
      const hasBranchPoints = yield* select(
        (state: OxalisState) => getBranchPoints(state.tracing).getOrElse([]).length > 0,
      );
      if (hasBranchPoints) {
        if (lastActionCreatedNode === true) {
          yield* put(deleteBranchPointAction());
        } else {
          Modal.confirm({
            title: "Jump again?",
            content: messages["tracing.branchpoint_jump_twice"],
            okText: "Jump again!",
            onOk: () => {
              Store.dispatch(deleteBranchPointAction());
            },
          });
        }
        lastActionCreatedNode = false;
      } else {
        Toast.warning(messages["tracing.no_more_branchpoints"]);
      }
    } else {
      lastActionCreatedNode = true;
    }
  }
}

function* watchFailedNodeCreations(): Saga<void> {
  while (true) {
    yield* take("CREATE_NODE");
    const activeTreeId = yield* select(state => enforceSkeletonTracing(state.tracing).activeTreeId);
    if (activeTreeId == null) {
      Toast.warning(messages["tracing.cant_create_node"]);
    }
  }
}

function* watchTracingConsistency(): Saga<void> {
  const state = yield* select(_state => _state);
  const invalidTreeDetails = [];

  for (const tree: Tree of _.values(enforceSkeletonTracing(state.tracing).trees)) {
    const edgeCount = tree.edges.size();
    const nodeCount = tree.nodes.size();
    // For a tree, edge_count = node_count - 1 should hold true. For graphs, the edge count
    // would be even higher.
    if (edgeCount < nodeCount - 1) {
      invalidTreeDetails.push({
        treeId: tree.treeId,
        name: tree.name,
        timestamp: tree.timestamp,
        isVisible: tree.isVisible,
        edgeCount,
        nodeCount,
      });
    }
  }

  if (invalidTreeDetails.length > 0) {
    const error = new Error("Corrupted tracing. See the action log for details.");
    Toast.error(messages["tracing.invalid_state"]);
    ErrorHandling.notify(error, { invalidTreeDetails });
  }
}

export function* watchTreeNames(): Saga<void> {
  const state = yield* select(_state => _state);

  // rename trees with an empty/default tree name
  for (const tree: Tree of _.values(enforceSkeletonTracing(state.tracing).trees)) {
    if (tree.name === "") {
      const newName = generateTreeName(state, tree.timestamp, tree.treeId);
      yield* put(setTreeNameAction(newName, tree.treeId));
    }
  }
}

export function* watchVersionRestoreParam(): Saga<void> {
  const showVersionRestore = yield* call(Utils.hasUrlParam, "showVersionRestore");
  if (showVersionRestore) {
    yield* put(setVersionRestoreVisibilityAction(true));
  }
}

export function* watchAgglomerateLoading(): Saga<void> {
  // Buffer actions since they might be dispatched before WK_READY
  const actionChannel = yield _actionChannel("LOAD_AGGLOMERATE_SKELETON");
  yield* take("INITIALIZE_SKELETONTRACING");
  yield* take("WK_READY");
  yield _takeEvery(actionChannel, loadAgglomerateSkeletonWithId);
  yield _takeEvery("REMOVE_AGGLOMERATE_SKELETON", removeAgglomerateSkeletonWithId);
}

function* loadAgglomerateSkeletonWithId(action: LoadAgglomerateSkeletonAction): Saga<void> {
  const allowUpdate = yield* select(state => state.tracing.restrictions.allowUpdate);
  if (!allowUpdate) return;

  const { layerName, mappingName, agglomerateId, destination } = action;
  if (agglomerateId === 0) {
    Toast.error(messages["tracing.agglomerate_skeleton.no_cell"]);
    return;
  }

  const dataset = yield* select(state => state.dataset);

  const layerInfo = getLayerByName(dataset, layerName);
  // If there is a fallbackLayer, request the agglomerate for that instead of the tracing segmentation layer
  const effectiveLayerName = layerInfo.fallbackLayer != null ? layerInfo.fallbackLayer : layerName;

  const progressCallback = createProgressCallback({ pauseDelay: 100, successMessageDelay: 2000 });
  const { hideFn } = yield* call(
    progressCallback,
    false,
    `Loading skeleton for agglomerate ${agglomerateId} with mapping ${mappingName}`,
  );

  try {
    const nmlProtoBuffer = yield* call(
      getAgglomerateSkeleton,
      dataset.dataStore.url,
      dataset,
      effectiveLayerName,
      mappingName,
      agglomerateId,
    );
    const parsedTracing = parseProtoTracing(nmlProtoBuffer, "skeleton");

    if (!parsedTracing.trees) {
      // This check is only for flow to realize that we have a skeleton tracing
      // on our hands.
      throw new Error("Skeleton tracing doesn't contain trees");
    }

    if (destination === "tracing") {
      yield* put(
        addTreesAndGroupsAction(
          createMutableTreeMapFromTreeArray(parsedTracing.trees),
          parsedTracing.treeGroups,
        ),
      );
    } else {
      yield* put(
        addConnectomeTreeAction(createMutableTreeMapFromTreeArray(parsedTracing.trees), layerName),
      );
    }
  } catch (e) {
    // Hide the progress notification and handle the error
    hideFn();
    console.error(e);
    ErrorHandling.notify(e);
    return;
  }

  yield* call(progressCallback, true, "Skeleton generation done.");
}

function* removeAgglomerateSkeletonWithId(action: LoadAgglomerateSkeletonAction): Saga<void> {
  const allowUpdate = yield* select(state => state.tracing.restrictions.allowUpdate);
  if (!allowUpdate) return;

  const { layerName, mappingName, agglomerateId, destination } = action;

  const findTreeWithName = (trees: TreeMap, treeName: string): ?Tree =>
    // $FlowIssue[incompatible-call]
    // $FlowIssue[incompatible-return] remove once https://github.com/facebook/flow/issues/2221 is fixed
    Object.values(trees).find((tree: Tree) => tree.name === treeName);

  // This is the pattern for the automatically assigned names for agglomerate skeletons
  const treeName = `agglomerate ${agglomerateId} (${mappingName})`;

  if (destination === "tracing") {
    const trees = yield* select(state => enforceSkeletonTracing(state.tracing).trees);
    const tree = findTreeWithName(trees, treeName);

    if (tree != null) {
      yield* put(deleteTreeAction(tree.treeId));
    }
  } else {
    const skeleton = yield* select(
      state => state.localSegmentationData[layerName].connectomeData.skeleton,
    );
    if (skeleton == null) return;
    const { trees } = skeleton;
    const tree = findTreeWithName(trees, treeName);

    if (tree != null) {
      yield* put(deleteConnectomeTreeAction(tree.treeId, layerName));
    }
  }
}

export function* watchSkeletonTracingAsync(): Saga<void> {
  yield* take("INITIALIZE_SKELETONTRACING");
  yield _takeEvery("WK_READY", watchTreeNames);
  yield _takeEvery(
    [
      "SET_ACTIVE_TREE",
      "SET_ACTIVE_TREE_BY_NAME",
      "SET_ACTIVE_NODE",
      "DELETE_NODE",
      "DELETE_BRANCHPOINT",
      "SELECT_NEXT_TREE",
      "DELETE_TREE",
      "DELETE_GROUP_AND_TREES",
      "CENTER_ACTIVE_NODE",
    ],
    centerActiveNode,
  );
  yield _throttle(5000, "PUSH_SAVE_QUEUE_TRANSACTION", watchTracingConsistency);
  yield* fork(watchFailedNodeCreations);
  yield* fork(watchBranchPointDeletion);
  yield* fork(watchVersionRestoreParam);
}

function* diffNodes(
  prevNodes: NodeMap,
  nodes: NodeMap,
  treeId: number,
): Generator<UpdateAction, void, void> {
  if (prevNodes === nodes) return;

  const { onlyA: deletedNodeIds, onlyB: addedNodeIds, changed: changedNodeIds } = diffDiffableMaps(
    prevNodes,
    nodes,
  );

  for (const nodeId of deletedNodeIds) {
    yield deleteNode(treeId, nodeId);
  }

  for (const nodeId of addedNodeIds) {
    const node = nodes.get(nodeId);
    yield createNode(treeId, node);
  }

  for (const nodeId of changedNodeIds) {
    const node = nodes.get(nodeId);
    const prevNode = prevNodes.get(nodeId);
    if (updateNodePredicate(prevNode, node)) {
      yield updateNode(treeId, node);
    }
  }
}

function updateNodePredicate(prevNode: Node, node: Node): boolean {
  return !_.isEqual(prevNode, node);
}

function* diffEdges(
  prevEdges: EdgeCollection,
  edges: EdgeCollection,
  treeId: number,
): Generator<UpdateAction, void, void> {
  if (prevEdges === edges) return;
  const { onlyA: deletedEdges, onlyB: addedEdges } = diffEdgeCollections(prevEdges, edges);
  for (const edge of deletedEdges) {
    yield deleteEdge(treeId, edge.source, edge.target);
  }
  for (const edge of addedEdges) {
    yield createEdge(treeId, edge.source, edge.target);
  }
}

function updateTracingPredicate(
  prevSkeletonTracing: SkeletonTracing,
  skeletonTracing: SkeletonTracing,
  prevFlycam: Flycam,
  flycam: Flycam,
): boolean {
  return prevSkeletonTracing.activeNodeId !== skeletonTracing.activeNodeId || prevFlycam !== flycam;
}

function updateTreePredicate(prevTree: Tree, tree: Tree): boolean {
  return (
    !_.isEqual(prevTree.branchPoints, tree.branchPoints) ||
    prevTree.color !== tree.color ||
    prevTree.name !== tree.name ||
    !_.isEqual(prevTree.comments, tree.comments) ||
    prevTree.timestamp !== tree.timestamp ||
    prevTree.groupId !== tree.groupId
  );
}

export function* diffTrees(
  prevTrees: TreeMap,
  trees: TreeMap,
): Generator<UpdateAction, void, void> {
  if (prevTrees === trees) return;
  const { onlyA: deletedTreeIds, onlyB: addedTreeIds, both: bothTreeIds } = Utils.diffArrays(
    _.map(prevTrees, tree => tree.treeId),
    _.map(trees, tree => tree.treeId),
  );

  for (const treeId of deletedTreeIds) {
    const prevTree = prevTrees[treeId];
    yield* diffNodes(prevTree.nodes, new DiffableMap(), treeId);
    yield* diffEdges(prevTree.edges, new EdgeCollection(), treeId);
    yield deleteTree(treeId);
  }
  for (const treeId of addedTreeIds) {
    const tree = trees[treeId];
    yield createTree(tree);
    yield* diffNodes(new DiffableMap(), tree.nodes, treeId);
    yield* diffEdges(new EdgeCollection(), tree.edges, treeId);
  }
  for (const treeId of bothTreeIds) {
    const tree = trees[treeId];
    const prevTree: Tree = prevTrees[treeId];
    if (tree !== prevTree) {
      yield* diffNodes(prevTree.nodes, tree.nodes, treeId);
      yield* diffEdges(prevTree.edges, tree.edges, treeId);
      if (updateTreePredicate(prevTree, tree)) {
        yield updateTree(tree);
      }
      if (prevTree.isVisible !== tree.isVisible) {
        yield updateTreeVisibility(tree);
      }
    }
  }
}

const diffTreeCache = {};

export function cachedDiffTrees(prevTrees: TreeMap, trees: TreeMap): Array<UpdateAction> {
  // Try to use the cached version of the diff if available to increase performance
  if (prevTrees !== diffTreeCache.prevTrees || trees !== diffTreeCache.trees) {
    diffTreeCache.prevTrees = prevTrees;
    diffTreeCache.trees = trees;
    diffTreeCache.diff = Array.from(diffTrees(prevTrees, trees));
  }
  return diffTreeCache.diff;
}

export function* diffSkeletonTracing(
  prevSkeletonTracing: SkeletonTracing,
  skeletonTracing: SkeletonTracing,
  prevFlycam: Flycam,
  flycam: Flycam,
): Generator<UpdateAction, void, void> {
  if (prevSkeletonTracing !== skeletonTracing) {
    yield* cachedDiffTrees(prevSkeletonTracing.trees, skeletonTracing.trees);
    if (prevSkeletonTracing.treeGroups !== skeletonTracing.treeGroups) {
      yield updateTreeGroups(skeletonTracing.treeGroups);
    }
  }
  if (updateTracingPredicate(prevSkeletonTracing, skeletonTracing, prevFlycam, flycam)) {
    yield updateSkeletonTracing(
      skeletonTracing,
      V3.floor(getPosition(flycam)),
      getRotation(flycam),
      flycam.zoomStep,
    );
  }
  if (!_.isEqual(prevSkeletonTracing.userBoundingBoxes, skeletonTracing.userBoundingBoxes)) {
    yield updateUserBoundingBoxes(skeletonTracing.userBoundingBoxes);
  }
}
