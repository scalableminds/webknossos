/*
 * skeletontracing_sagas.js
 * @flow
 */
import _ from "lodash";
import { Modal } from "antd";
import * as Utils from "libs/utils";
import Toast from "libs/toast";
import messages from "messages";
import Store from "oxalis/store";
import {
  fork,
  put,
  take,
  _take,
  _takeEvery,
  select,
  race,
  call,
} from "oxalis/model/sagas/effect-generators";
import type { Saga } from "oxalis/model/sagas/effect-generators";
import {
  deleteBranchPointAction,
  setTreeNameAction,
} from "oxalis/model/actions/skeletontracing_actions";
import {
  createTree,
  deleteTree,
  updateTree,
  toggleTree,
  createNode,
  deleteNode,
  updateNode,
  createEdge,
  deleteEdge,
  updateSkeletonTracing,
  updateTreeGroups,
} from "oxalis/model/sagas/update_actions";
import type { Action } from "oxalis/model/actions/actions";
import { setPositionAction, setRotationAction } from "oxalis/model/actions/flycam_actions";
import { getPosition, getRotation } from "oxalis/model/accessors/flycam_accessor";
import {
  getActiveNode,
  getBranchPoints,
  enforceSkeletonTracing,
} from "oxalis/model/accessors/skeletontracing_accessor";
import { V3 } from "libs/mjs";
import { generateTreeName } from "oxalis/model/reducers/skeletontracing_reducer_helpers";
import type {
  SkeletonTracing,
  Node,
  Tree,
  TreeMap,
  NodeMap,
  Flycam,
  OxalisState,
} from "oxalis/store";
import type { UpdateAction } from "oxalis/model/sagas/update_actions";
import api from "oxalis/api/internal_api";
import DiffableMap, { diffDiffableMaps } from "libs/diffable_map";
import EdgeCollection, { diffEdgeCollections } from "oxalis/model/edge_collection";
import { setVersionRestoreVisibilityAction } from "oxalis/model/actions/ui_actions";

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
    const activeGroupId = yield* select(
      state => enforceSkeletonTracing(state.tracing).activeGroupId,
    );
    if (activeGroupId != null) {
      Toast.warning(messages["tracing.cant_create_node_due_to_active_group"]);
    }
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
      "SET_ACTIVE_NODE",
      "DELETE_NODE",
      "DELETE_BRANCHPOINT",
      "SELECT_NEXT_TREE",
      "DELETE_TREE",
      "UNDO",
      "REDO",
    ],
    centerActiveNode,
  );
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
  return (
    !_.isEqual(prevSkeletonTracing.userBoundingBox, skeletonTracing.userBoundingBox) ||
    prevSkeletonTracing.activeNodeId !== skeletonTracing.activeNodeId ||
    prevFlycam !== flycam
  );
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
        yield toggleTree(tree);
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
}
