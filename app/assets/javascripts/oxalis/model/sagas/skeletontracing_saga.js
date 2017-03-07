/*
 * skeletontracing_sagas.js
 * @flow
 */
import { call, take, takeEvery, select } from "redux-saga/effects";
import Request from "libs/request";
import { SkeletonTracingActions } from "oxalis/model/actions/skeletontracing_actions";
import _ from "lodash";

function* centerActiveNode() {
  const { activeNodeId, activeTreeId, trees } = yield select(state => state.skeletonTracing);
  const position = trees[activeTreeId].nodes[activeNodeId].position;

  // Should be an action in the future
  window.webknossos.model.flycam.setPosition(position);
}

export function* watchSkeletonTracingAsync(): Generator<*, *, *> {
  yield takeEvery(["CREATE_NODE", "SET_ACTIVE_TREE", "SET_ACTIVE_NODE", "DELETE_NODE"], centerActiveNode);
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

// function diffArrays<T>(stateA: Array<T>, stateB: Array<T>): { both: Array<T>, onlyA: Array<T>, onlyB: Array<T> } {
//   const both = [];
//   const onlyA = [];
//   const onlyB = [];
//
//   for (const itemA of stateA) {
//     if (stateB.includes(itemA)) {
//       both.push(itemA);
//     } else {
//       onlyA.push(itemA);
//     }
//   }
//   for (const itemB of stateB) {
//     if (!stateB.includes(itemB)) {
//       onlyB.push(itemB);
//     }
//   }
//   return { both, onlyA, onlyB };
// }


// function* pushToQueue(updateAction: UpdateAction) {
//   console.log(updateAction);
// }

// function* performDiff(prevSkeletonTracing: SkeletonTracingType, skeletonTracing: SkeletonTracingType) {
//   if (prevSkeletonTracing.trees !== skeletonTracing.trees) {
//     const { onlyA: prevTreeIds, onlyB: nextTreeIds, both: bothTreeIds } = diffArrays(
//       _.map(prevSkeletonTracing.trees, tree => tree.treeId),
//       _.map(skeletonTracing.trees, tree => tree.treeId),
//     );
//     for (const treeId of prevTreeIds) {
//       yield call(pushToQueue, deleteTree(treeId));
//     }
//     for (const treeId of nextTreeIds) {
//       const tree = skeletonTracing.trees[treeId];
//       yield call(pushToQueue, createTree(tree));
//     }
//     for (const treeId of bothTreeIds) {
//       const tree = skeletonTracing.trees[treeId];
//       yield call(pushToQueue, updateTree(tree));
//     }
//   }
// }

// export function* diffTrees(): Generator<*, *, *> {
//   yield take("INITIALIZE_SKELETONTRACING");
//   let prevSkeletonTracing = yield select(state => state.skeletonTracing);
//   while (true) {
//     const action = yield take(SkeletonTracingActions);
//     const skeletonTracing = yield select(state => state.skeletonTracing);
//     yield call(performDiff, prevSkeletonTracing, skeletonTracing);
//     prevSkeletonTracing = skeletonTracing;
//   }
// }
