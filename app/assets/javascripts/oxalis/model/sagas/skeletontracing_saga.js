/*
 * skeletontracing_sagas.js
 * @flow
 */
import app from "app";
import { call, put, take, takeEvery, select } from "redux-saga/effects";
import type { SkeletonTracingType, NodeType, TreeType, TreeMapType, NodeMapType, EdgeType } from "oxalis/store";
import { SkeletonTracingActions, createTreeAction } from "oxalis/model/actions/skeletontracing_actions";
import { pushSaveQueueAction } from "oxalis/model/actions/save_actions";
import { createTree, deleteTree, updateTree, createNode, deleteNode, updateNode, createEdge, deleteEdge, updateTracing, moveTreeComponent } from "oxalis/model/sagas/update_actions";
import type { UpdateAction } from "oxalis/model/sagas/update_actions";
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


export function* pushToQueue(updateActions: Array<UpdateAction>): Generator<*, *, *> {
  yield put(pushSaveQueueAction(updateActions));
}


function* performDiffNodes(prevNodes: NodeMapType, nodes: NodeMapType, treeId: number): Generator<UpdateAction, void, void> {
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

function* performDiffEdges(prevEdges: Array<EdgeType>, edges: Array<EdgeType>, treeId: number): Generator<UpdateAction, void, void> {
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

function* performDiffTrees(prevTrees: TreeMapType, trees: TreeMapType): Generator<UpdateAction, void, void> {
  if (prevTrees === trees) return;
  const { onlyA: deletedTreeIds, onlyB: addedTreeIds, both: bothTreeIds } = Utils.diffArrays(
    _.map(prevTrees, tree => tree.treeId),
    _.map(trees, tree => tree.treeId),
  );
  for (const treeId of deletedTreeIds) {
    const prevTree = prevTrees[treeId];
    yield* performDiffNodes(prevTree.nodes, {}, treeId);
    yield* performDiffEdges(prevTree.edges, [], treeId);
    yield deleteTree(treeId);
  }
  for (const treeId of addedTreeIds) {
    const tree = trees[treeId];
    yield createTree(tree);
    yield* performDiffNodes({}, tree.nodes, treeId);
    yield* performDiffEdges([], tree.edges, treeId);
  }
  for (const treeId of bothTreeIds) {
    const tree = trees[treeId];
    const prevTree = prevTrees[treeId];
    if (tree !== prevTree) {
      yield* performDiffNodes(prevTree.nodes, tree.nodes, treeId);
      yield* performDiffEdges(prevTree.edges, tree.edges, treeId);
      if (updateTreePredicate(prevTree, tree)) {
        yield updateTree(tree);
      }
    }
  }
}

function* pushUpdateTracing(skeletonTracing: SkeletonTracingType) {
  yield call(pushToQueue, [updateTracing(skeletonTracing,
    yield select(() => V3.floor(window.webknossos.model.flycam.getPosition())),
    yield select(() => window.webknossos.model.flycam3d.getRotation()),
    yield select(() => window.webknossos.model.flycam.getZoomStep()),
  )]);
}

function* performDiffTracing(prevSkeletonTracing: SkeletonTracingType, skeletonTracing: SkeletonTracingType) {
  if (prevSkeletonTracing !== skeletonTracing) {
    yield call(pushToQueue, Array.from(performDiffTrees(prevSkeletonTracing.trees, skeletonTracing.trees)));
    yield call(pushUpdateTracing, skeletonTracing);
  }
}

export function* saveSkeletonTracingAsync(): Generator<*, *, *> {
  yield take("INITIALIZE_SKELETONTRACING");
  let prevSkeletonTracing = yield select(state => state.skeletonTracing);
  if (yield select(state => state.skeletonTracing.activeTreeId == null)) {
    yield put(createTreeAction());
  }
  yield take("WK_READY");
  while (true) {
    yield take(SkeletonTracingActions);
    const skeletonTracing = yield select(state => state.skeletonTracing);
    yield call(performDiffTracing, prevSkeletonTracing, skeletonTracing);
    prevSkeletonTracing = skeletonTracing;
  }
}
