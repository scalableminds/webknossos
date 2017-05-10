// @flow

import { select, put, take } from "redux-saga/effects";
import { setTreeNameAction } from "oxalis/model/actions/skeletontracing_actions";
import { generateTreeName } from "oxalis/model/reducers/skeletontracing_reducer_helpers";
import type { TreeType } from "oxalis/store";


export function* initializeTaskAsync(): Generator<*, *, *> {
  yield take("SET_TASK");
  yield take("INITIALIZE_SKELETONTRACING");

  const state = yield select(state => state);
  const trees = state.skeletonTracing.trees;

  // rename trees without an empty/default tree name for tasks
  if (state.task !== null) {
    for (const tree of Object.values(trees)) {
      if (tree.name === "") {
        const newName = generateTreeName(state, tree.timestamp, tree.treeId);
        yield put(setTreeNameAction(newName, tree.treeId));
      }
    }
  }
}

