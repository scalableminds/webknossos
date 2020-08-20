/*
 * skeletontracing_sagas.js
 * @flow
 */
import { Modal } from "antd";
import _ from "lodash";

import type { Action } from "oxalis/model/actions/actions";
import {
  type Saga,
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
} from "oxalis/model/actions/skeletontracing_actions";
import { generateTreeName } from "oxalis/model/reducers/skeletontracing_reducer_helpers";
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

function* centerActiveNode(action: Action): Saga<void> {
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

export function cachedDiffTrees(
  prevSkeletonTracing: SkeletonTracing,
  skeletonTracing: SkeletonTracing,
): Array<UpdateAction> {
  const { trees } = skeletonTracing;
  const prevTrees = prevSkeletonTracing.trees;
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
    yield* cachedDiffTrees(prevSkeletonTracing, skeletonTracing);
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
