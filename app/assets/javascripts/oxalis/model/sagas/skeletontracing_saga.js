/*
 * skeletontracing_sagas.js
 * @flow
 */
import app from "app";
import _ from "lodash";
import Utils from "libs/utils";
import Toast from "libs/toast";
import messages from "messages";
import Store from "oxalis/store";
import Modal from "oxalis/view/modal";
import { put, take, takeEvery, select, race } from "redux-saga/effects";
import { deleteBranchPointAction, setTreeNameAction } from "oxalis/model/actions/skeletontracing_actions";
import { createTree, deleteTree, updateTree, createNode, deleteNode, updateNode, createEdge, deleteEdge, updateSkeletonTracing } from "oxalis/model/sagas/update_actions";
import { getPosition, getRotation } from "oxalis/model/accessors/flycam_accessor";
import { getActiveNode, getBranchPoints } from "oxalis/model/accessors/skeletontracing_accessor";
import { V3 } from "libs/mjs";
import { generateTreeName } from "oxalis/model/reducers/skeletontracing_reducer_helpers";
import type { SkeletonTracingType, NodeType, TreeType, TreeMapType, NodeMapType, EdgeType, FlycamType } from "oxalis/store";
import type { UpdateAction } from "oxalis/model/sagas/update_actions";

function* centerActiveNode() {
  getActiveNode(yield select(state => state.tracing))
    .map((activeNode) => {
      // $FlowFixMe
      app.oxalis.planeController.centerPositionAnimated(activeNode.position, false);
    });
}

export function* watchBranchPointDeletion(): Generator<*, *, *> {
  while (true) {
    yield take("REQUEST_DELETE_BRANCHPOINT");
    const hasBranchPoints = yield select(state => getBranchPoints(state.tracing).getOrElse([]).length > 0);
    if (hasBranchPoints) {
      yield put(deleteBranchPointAction());

      const { deleteBranchpointAction } = yield race({
        deleteBranchpointAction: take("REQUEST_DELETE_BRANCHPOINT"),
        createNodeAction: take("CREATE_NODE"),
      });

      if (deleteBranchpointAction) {
        const hasBranchPoints2 = yield select(state => getBranchPoints(state.tracing).getOrElse([]).length > 0);
        if (hasBranchPoints2) {
          Modal.show(messages["tracing.branchpoint_jump_twice"],
            "Jump again?",
            [{ id: "jump-button", label: "Jump again", callback: () => { Store.dispatch(deleteBranchPointAction()); } },
             { id: "cancel-button", label: "Cancel" }]);
        } else {
          Toast.warning(messages["tracing.no_more_branchpoints"]);
        }
      }
    } else {
      Toast.warning(messages["tracing.no_more_branchpoints"]);
    }
  }
}

export function* watchTreeNames(): Generator<*, *, *> {
  const state = yield select(_state => _state);

  // rename trees with an empty/default tree name
  for (const tree: TreeType of _.values(state.tracing.trees)) {
    if (tree.name === "") {
      const newName = generateTreeName(state, tree.timestamp, tree.treeId);
      yield put(setTreeNameAction(newName, tree.treeId));
    }
  }
}

export function* watchSkeletonTracingAsync(): Generator<*, *, *> {
  yield takeEvery(["SET_ACTIVE_TREE", "SET_ACTIVE_NODE", "DELETE_NODE", "DELETE_BRANCHPOINT"], centerActiveNode);
  yield takeEvery(["INITIALIZE_SKELETONTRACING"], watchTreeNames);
  yield watchBranchPointDeletion();
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


const diffTreeCache = {};

export function cachedDiffTrees(prevTrees: TreeMapType, trees: TreeMapType): Array<UpdateAction> {
  // Try to use the cached version of the diff if available to increase performance
  if (prevTrees !== diffTreeCache.prevTrees || trees !== diffTreeCache.trees) {
    diffTreeCache.prevTrees = prevTrees;
    diffTreeCache.trees = trees;
    diffTreeCache.diff = Array.from(diffTrees(prevTrees, trees));
  }
  return diffTreeCache.diff;
}

export function* diffSkeletonTracing(
  prevSkeletonTracing: SkeletonTracingType,
  skeletonTracing: SkeletonTracingType,
  flycam: FlycamType,
): Generator<UpdateAction, *, *> {
  if (prevSkeletonTracing !== skeletonTracing) {
    yield* cachedDiffTrees(prevSkeletonTracing.trees, skeletonTracing.trees);
  }
  yield updateSkeletonTracing(
    skeletonTracing,
    V3.floor(getPosition(flycam)),
    getRotation(flycam),
    flycam.zoomStep,
  );
}
