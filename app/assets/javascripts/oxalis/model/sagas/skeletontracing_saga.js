/*
 * skeletontracing_sagas.js
 * @flow
 */
import { call, take, takeEvery, select } from "redux-saga/effects";
import Request from "libs/request";
import { SkeletonTracingActions } from "oxalis/model/actions/skeletontracing_actions";
import type { SkeletonTracingType, BranchPointType, CommentType, TreeType, NodeType } from "oxalis/store";
import { V3 } from "libs/mjs";
import * as THREE from "three";
import _ from "lodash";
import type { Vector3, Vector4 } from "oxalis/constants";

function* centerActiveNode() {
  const { activeNodeId, activeTreeId, trees } = yield select(state => state.skeletonTracing);
  const position = trees[activeTreeId].nodes[activeNodeId].position;

  // Should be an action in the future
  window.webknossos.model.flycam.setPosition(position);
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

function diffArrays<T>(stateA: Array<T>, stateB: Array<T>): { both: Array<T>, onlyA: Array<T>, onlyB: Array<T> } {
  const both = [];
  const onlyA = [];
  const onlyB = [];

  for (const itemA of stateA) {
    if (stateB.includes(itemA)) {
      both.push(itemA);
    } else {
      onlyA.push(itemA);
    }
  }
  for (const itemB of stateB) {
    if (!stateB.includes(itemB)) {
      onlyB.push(itemB);
    }
  }
  return { both, onlyA, onlyB };
}

type UpdateTreeUpdateAction = {
  action: "createTree" | "updateTree",
  value: {
    id: number,
    updatedId: ?number,
    color: Vector4,
    name: string,
    timestamp: number,
    comments: Array<CommentType>,
    branchPoints: Array<BranchPointType>,
  }
};
type DeleteTreeUpdateAction = {
  action: "deleteTree", value: { id: number },
};
type MoveTreeComponentUpdateAction = {
  action: "moveTreeComponent",
  value: {
    sourceId: number,
    targetId: number,
    nodeIds: Array<number>,
  }
}
type MergeTreeUpdateAction = {
  action: "mergeTree",
  value: {
    sourceId: number,
    targetId: number,
  },
};
type CreateNodeUpdateAction = {
  action: "createNode",
  value: NodeType,
};
type UpdateNodeUpdateAction = {
  action: "updateNode",
  value: NodeType,
};
type DeleteNodeUpdateAction = {
  action: "deleteNode",
  value: {
    treeId: number,
    id: number,
  },
};
type CreateEdgeUpdateAction = {
  action: "createEdge",
  value: {
    treeId: number,
    source: number,
    target: number,
  }
};
type UpdateTracingUpdateAction = {
  action: "updateTracing",
  value: {
    activeNode: number,
    editPosition: Vector3,
    editRotation: Vector3,
    zoomLevel: number,
  },
};
type UpdateAction =
  UpdateTreeUpdateAction |
  DeleteTreeUpdateAction |
  MergeTreeUpdateAction |
  MoveTreeComponentUpdateAction |
  CreateNodeUpdateAction |
  UpdateNodeUpdateAction |
  DeleteNodeUpdateAction |
  CreateEdgeUpdateAction |
  // DeleteEdgeUpdateAction |
  UpdateTracingUpdateAction;

function createTree(tree: TreeType): UpdateTreeUpdateAction {
  const treeColor = new THREE.Color(tree.color);
  return {
    action: "createTree",
    value: {
      id: tree.treeId,
      updatedId: undefined,
      color: [treeColor.r, treeColor.g, treeColor.b, 1],
      name: tree.name,
      timestamp: tree.timestamp,
      comments: tree.comments,
      branchPoints: tree.branchPoints,
    },
  };
}
function deleteTree(treeId: number): DeleteTreeUpdateAction {
  return {
    action: "deleteTree",
    value: {
      id: treeId,
    },
  };
}
function updateTree(tree: TreeType): UpdateTreeUpdateAction {
  const treeColor = new THREE.Color(tree.color);
  return {
    action: "updateTree",
    value: {
      id: tree.treeId,
      updatedId: tree.treeId,
      color: [treeColor.r, treeColor.g, treeColor.b, 1],
      name: tree.name,
      timestamp: tree.timestamp,
      comments: tree.comments,
      branchPoints: tree.branchPoints,
    },
  };
}
function mergeTree(sourceTreeId: number, targetTreeId: number): MergeTreeUpdateAction {
  return {
    action: "mergeTree",
    value: {
      sourceId: sourceTreeId,
      targetId: targetTreeId,
    },
  };
}
function createEdge(treeId, sourceNodeId: number, targetNodeId: number): CreateEdgeUpdateAction {
  return {
    action: "createEdge",
    value: {
      treeId,
      source: sourceNodeId,
      target: targetNodeId,
    },
  };
}
function createNode(node: NodeType): CreateNodeUpdateAction {
  return {
    action: "createNode",
    value: node,
  };
}
function updateNode(node: NodeType): UpdateNodeUpdateAction {
  return {
    action: "updateNode",
    value: node,
  };
}
function deleteNode(treeId: number, node: NodeType): DeleteNodeUpdateAction {
  return {
    action: "deleteNode",
    value: { treeId, id: node.id },
  };
}
function updateTracing(tracing: SkeletonTracingType): UpdateTracingUpdateAction {
  return {
    action: "updateTracing",
    value: {
      activeNode: tracing.activeNodeId,
      editPosition: V3.floor(window.webknossos.model.flycam.getPosition()),
      editRotation: window.webknossos.model.flycam3d.getRotation(),
      zoomLevel: window.webknossos.model.flycam.getZoomStep(),
    },
  };
}
function moveTreeComponent(sourceTreeId: number, targetTreeId: number, nodeIds: Array<number>): MoveTreeComponentUpdateAction {
  return {
    action: "moveTreeComponent",
    value: {
      sourceId: sourceTreeId,
      targetId: targetTreeId,
      nodeIds,
    },
  };
}

function* pushToQueue(updateAction: UpdateAction) {
  console.log(updateAction);
}

function* performDiff(prevSkeletonTracing: SkeletonTracingType, skeletonTracing: SkeletonTracingType) {
  if (prevSkeletonTracing.trees !== skeletonTracing.trees) {
    const { onlyA: prevTreeIds, onlyB: nextTreeIds, both: bothTreeIds } = diffArrays(
      _.map(prevSkeletonTracing.trees, tree => tree.treeId),
      _.map(skeletonTracing.trees, tree => tree.treeId),
    );
    for (const treeId of prevTreeIds) {
      yield call(pushToQueue, deleteTree(treeId));
    }
    for (const treeId of nextTreeIds) {
      const tree = skeletonTracing.trees[treeId];
      yield call(pushToQueue, createTree(tree));
    }
    for (const treeId of bothTreeIds) {
      const tree = skeletonTracing.trees[treeId];
      yield call(pushToQueue, updateTree(tree));
    }
  }
}

export function* diffTrees(): Generator<*, *, *> {
  yield take("INITIALIZE_SKELETONTRACING");
  let prevSkeletonTracing = yield select(state => state.skeletonTracing);
  while (true) {
    const action = yield take(SkeletonTracingActions);
    const skeletonTracing = yield select(state => state.skeletonTracing);
    yield call(performDiff, prevSkeletonTracing, skeletonTracing);
    prevSkeletonTracing = skeletonTracing;
  }
}

export function* watchSkeletonTracingAsync(): Generator<*, *, *> {
  yield takeEvery(["CREATE_NODE", "SET_ACTIVE_TREE", "SET_ACTIVE_NODE", "DELETE_NODE"], centerActiveNode);
}
