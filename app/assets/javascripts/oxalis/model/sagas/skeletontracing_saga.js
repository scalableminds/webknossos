/*
 * skeletontracing_sagas.js
 * @flow
 */
import app from "app";
import { call, put, take, takeEvery, select } from "redux-saga/effects";
import type { SkeletonTracingType, NodeType, TreeType, TreeMapType, NodeMapType, EdgeType, Flycam3DType } from "oxalis/store";
import { SkeletonTracingActions, createTreeAction } from "oxalis/model/actions/skeletontracing_actions";
import { pushSaveQueueAction } from "oxalis/model/actions/save_actions";
import { createTree, deleteTree, updateTree, createNode, deleteNode, updateNode, createEdge, deleteEdge, updateTracing } from "oxalis/model/sagas/update_actions";
import type { UpdateAction } from "oxalis/model/sagas/update_actions";
import { Flycam3DActions } from "oxalis/model/actions/flycam3d_actions";
import { getPosition, getRotation } from "oxalis/model/accessors/flycam3d_accessor";
import _ from "lodash";
import Utils from "libs/utils";
import { V3 } from "libs/mjs";

function* centerActiveNode() {
  const { activeNodeId, activeTreeId, trees } = yield select(state => state.skeletonTracing);

  if (activeNodeId) {
    // Should be an action in the future
    const position = trees[activeTreeId].nodes[activeNodeId].position;
    app.oxalis.planeController.centerPositionAnimated(position);
  }
}

export function* watchSkeletonTracingAsync(): Generator<*, *, *> {
  yield take("WK_READY");
  yield takeEvery(["SET_ACTIVE_TREE", "SET_ACTIVE_NODE", "DELETE_NODE"], centerActiveNode);
}

function* diffNodes(prevNodes: NodeMapType, nodes: NodeMapType, treeId: number): Generator<UpdateAction, void, void> {
  if (prevNodes === nodes) return;
  const { onlyA: deletedNodeIds, onlyB: addedNodeIds, both: bothNodeIds } = Utils.diffArrays(
    _.map(prevNodes, node => node.id),
    _.map(nodes, node => node.id),
  );
  for (const nodeId of deletedNodeIds) {
    yield deleteNode(treeId, nodeId);
  }
  for (const nodeId of addedNodeIds) {
    const node = nodes[nodeId];
    yield createNode(treeId, node);
  }
  for (const nodeId of bothNodeIds) {
    const node = nodes[nodeId];
    const prevNode = prevNodes[nodeId];
    if (node !== prevNode) {
      if (updateNodePredicate(prevNode, node)) {
        yield updateNode(treeId, node);
      }
    }
  }
}

function updateNodePredicate(prevNode: NodeType, node: NodeType): boolean {
  return !_.isEqual(prevNode, node);
}

function* diffEdges(prevEdges: Array<EdgeType>, edges: Array<EdgeType>, treeId: number): Generator<UpdateAction, void, void> {
  if (prevEdges === edges) return;
  const { onlyA: deletedEdges, onlyB: addedEdges } = Utils.diffArrays(prevEdges, edges);
  for (const edge of deletedEdges) {
    yield deleteEdge(treeId, edge.source, edge.target);
  }
  for (const edge of addedEdges) {
    yield createEdge(treeId, edge.source, edge.target);
  }
}

function updateTreePredicate(prevTree: TreeType, tree: TreeType): boolean {
  return prevTree.branchPoints !== tree.branchPoints ||
    prevTree.color !== tree.color ||
    prevTree.name !== tree.name ||
    !_.isEqual(prevTree.comments, tree.comments) ||
    !_.isEqual(prevTree.timestamp, tree.timestamp);
}

export function* diffTrees(prevTrees: TreeMapType, trees: TreeMapType): Generator<UpdateAction, void, void> {
  if (prevTrees === trees) return;
  const { onlyA: deletedTreeIds, onlyB: addedTreeIds, both: bothTreeIds } = Utils.diffArrays(
    _.map(prevTrees, tree => tree.treeId),
    _.map(trees, tree => tree.treeId),
  );
  for (const treeId of deletedTreeIds) {
    const prevTree = prevTrees[treeId];
    yield* diffNodes(prevTree.nodes, {}, treeId);
    yield* diffEdges(prevTree.edges, [], treeId);
    yield deleteTree(treeId);
  }
  for (const treeId of addedTreeIds) {
    const tree = trees[treeId];
    yield createTree(tree);
    yield* diffNodes({}, tree.nodes, treeId);
    yield* diffEdges([], tree.edges, treeId);
  }
  for (const treeId of bothTreeIds) {
    const tree = trees[treeId];
    const prevTree = prevTrees[treeId];
    if (tree !== prevTree) {
      yield* diffNodes(prevTree.nodes, tree.nodes, treeId);
      yield* diffEdges(prevTree.edges, tree.edges, treeId);
      if (updateTreePredicate(prevTree, tree)) {
        yield updateTree(tree);
      }
    }
  }
}

export function* diffTracing(
  prevSkeletonTracing: SkeletonTracingType,
  skeletonTracing: SkeletonTracingType,
  flycam3d: Flycam3DType,
): Generator<UpdateAction, *, *> {
  if (prevSkeletonTracing !== skeletonTracing) {
    yield* diffTrees(prevSkeletonTracing.trees, skeletonTracing.trees);
  }
  yield updateTracing(
    skeletonTracing,
    V3.floor(getPosition(flycam3d)),
    getRotation(flycam3d),
    flycam3d.zoomStep,
  );
}

export function performDiffTracing(
  prevSkeletonTracing: SkeletonTracingType,
  skeletonTracing: SkeletonTracingType,
  flycam3d: Flycam3DType,
): Array<UpdateAction> {
  return Array.from(diffTracing(prevSkeletonTracing, skeletonTracing, flycam3d));
}

export function* saveSkeletonTracingAsync(): Generator<*, *, *> {
  yield take("INITIALIZE_SKELETONTRACING");
  let prevSkeletonTracing = yield select(state => state.skeletonTracing);
  if (yield select(state => state.skeletonTracing.activeTreeId == null)) {
    yield put(createTreeAction());
  }
  yield take("WK_READY");
  while (true) {
    yield take(SkeletonTracingActions.concat(Flycam3DActions));
    const skeletonTracing = yield select(state => state.skeletonTracing);
    const flycam3d = yield select(state => state.flycam3d);
    const items = Array.from(yield call(performDiffTracing,
      prevSkeletonTracing, skeletonTracing, flycam3d));
    if (items.length > 0) {
      yield put(pushSaveQueueAction(items));
    }
    prevSkeletonTracing = skeletonTracing;
  }
}
