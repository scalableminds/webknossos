/*
 * skeletontracing_sagas.js
 * @flow
 */
import app from "app";
import { call, take, takeEvery, select } from "redux-saga/effects";
import Request from "libs/request";
import type { SkeletonTracingType, NodeType, TreeType, TreeMapType, NodeMapType, EdgeType } from "oxalis/store";
import { SkeletonTracingActions } from "oxalis/model/actions/skeletontracing_actions";
import { createTree, deleteTree, updateTree, createNode, deleteNode, updateNode, createEdge, deleteEdge, updateTracing } from "oxalis/model/sagas/update_actions";
import type { UpdateAction } from "oxalis/model/sagas/update_actions";
import _ from "lodash";
import Utils from "libs/utils";

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

function* pushAnnotation(action, payload) {
  const APICall = Request.sendJSONReceiveJSON(
    `/annotations/${this.tracingType}/${this.tracingId}?version=${(version + 1)}`, {
      method: "PUT",
      data: [{
        action,
        value: payload,
      }],
    },
  );
  yield call(APICall);
}

function* pushToQueue(updateAction: UpdateAction) {
  console.log(updateAction);
}


function* performDiffNodes(prevNodes: NodeMapType, nodes: NodeMapType, treeId: number) {
  if (prevNodes === nodes) return;
  const { onlyA: deletedNodeIds, onlyB: addedNodeIds, both: bothNodeIds } = Utils.diffArrays(
    _.map(prevNodes, node => node.id),
    _.map(nodes, node => node.id),
  );
  for (const nodeId of deletedNodeIds) {
    yield call(pushToQueue, deleteNode(treeId, nodeId));
  }
  for (const nodeId of addedNodeIds) {
    const node = nodes[nodeId];
    yield call(pushToQueue, createNode(node));
  }
  for (const nodeId of bothNodeIds) {
    const node = nodes[nodeId];
    const prevNode = prevNodes[nodeId];
    if (node !== prevNode) {
      if (updateNodePredicate(prevNode, node)) {
        yield call(pushToQueue, updateNode(node));
      }
    }
  }
}

function updateNodePredicate(prevNode: NodeType, node: NodeType): boolean {
  return !_.isEqual(prevNode, node);
}

function* performDiffEdges(prevEdges: Array<EdgeType>, edges: Array<EdgeType>, treeId: number) {
  if (prevEdges === edges) return;
  const { onlyA: deletedEdges, onlyB: addedEdges } = Utils.diffArrays(prevEdges, edges);
  for (const edge of deletedEdges) {
    yield call(pushToQueue, deleteEdge(treeId, edge.source, edge.target));
  }
  for (const edge of addedEdges) {
    yield call(pushToQueue, createEdge(treeId, edge.source, edge.target));
  }
}

function updateTreePredicate(prevTree: TreeType, tree: TreeType): boolean {
  return prevTree.branchPoints !== tree.branchPoints ||
    prevTree.color !== tree.color ||
    prevTree.comments !== tree.comments ||
    prevTree.name !== tree.name ||
    prevTree.timestamp !== tree.timestamp;
}

function* performDiffTrees(prevTrees: TreeMapType, trees: TreeMapType) {
  if (prevTrees === trees) return;
  const { onlyA: deletedTreeIds, onlyB: addedTreeIds, both: bothTreeIds } = Utils.diffArrays(
    _.map(prevTrees, tree => tree.treeId),
    _.map(trees, tree => tree.treeId),
  );
  for (const treeId of deletedTreeIds) {
    yield call(pushToQueue, deleteTree(treeId));
  }
  for (const treeId of addedTreeIds) {
    const tree = trees[treeId];
    yield call(pushToQueue, createTree(tree));
  }
  for (const treeId of bothTreeIds) {
    const tree = trees[treeId];
    const prevTree = prevTrees[treeId];
    if (tree !== prevTree) {
      yield call(performDiffNodes, prevTree.nodes, tree.nodes, treeId);
      yield call(performDiffEdges, prevTree.edges, tree.edges, treeId);
      if (updateTreePredicate(prevTree, tree)) {
        yield call(pushToQueue, updateTree(tree));
      }
    }
  }
}

function* performDiffTracing(prevSkeletonTracing: SkeletonTracingType, skeletonTracing: SkeletonTracingType) {
  if (prevSkeletonTracing !== skeletonTracing) {
    yield call(pushToQueue, updateTracing(skeletonTracing));
    yield call(performDiffTrees, prevSkeletonTracing.trees, skeletonTracing.trees);
  }
}

export function* saveSkeletonTracingAsync(): Generator<*, *, *> {
  yield take("INITIALIZE_SKELETONTRACING");
  let prevSkeletonTracing = yield select(state => state.skeletonTracing);
  while (true) {
    yield take(SkeletonTracingActions);
    const skeletonTracing = yield select(state => state.skeletonTracing);
    yield call(performDiffTracing, prevSkeletonTracing, skeletonTracing);
    prevSkeletonTracing = skeletonTracing;
  }
}
