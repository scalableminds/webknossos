/*
 * save_saga.js
 * @flow
 */

import _ from "lodash";
import app from "app";
import Request from "libs/request";
import Date from "libs/date";
import messages from "messages";
import Toast from "libs/toast";
import { call, put, take, select, race } from "redux-saga/effects";
import { delay } from "redux-saga";
import { shiftSaveQueueAction, setSaveBusyAction, setLastSaveTimestampAction, pushSaveQueueAction, setVersionNumberAction } from "oxalis/model/actions/save_actions";
import { createTreeAction, SkeletonTracingActions } from "oxalis/model/actions/skeletontracing_actions";
import { VolumeTracingSaveRelevantActions } from "oxalis/model/actions/volumetracing_actions";
import { FlycamActions } from "oxalis/model/actions/flycam_actions";
import { alert } from "libs/window";
import { diffSkeletonTracing } from "oxalis/model/sagas/skeletontracing_saga";
import { diffVolumeTracing } from "oxalis/model/sagas/volumetracing_saga";
import type { UpdateAction } from "oxalis/model/sagas/update_actions";
import type { TracingType, FlycamType } from "oxalis/store";
import { moveTreeComponent } from "oxalis/model/sagas/update_actions";

const PUSH_THROTTLE_TIME = 30000; // 30s
const SAVE_RETRY_WAITING_TIME = 5000;

export function* pushAnnotationAsync(): Generator<*, *, *> {
  yield take(["INITIALIZE_SKELETONTRACING", "INITIALIZE_VOLUMETRACING"]);
  yield put(setLastSaveTimestampAction());
  while (true) {
    const pushAction = yield take("PUSH_SAVE_QUEUE");
    if (!pushAction.pushNow) {
      yield race({
        timeout: call(delay, PUSH_THROTTLE_TIME),
        forcePush: take("SAVE_NOW"),
      });
    }
    yield put(setSaveBusyAction(true));
    const saveQueue = yield select(state => state.save.queue);
    if (saveQueue.length > 0) {
      yield call(sendRequestToServer);
    }
    yield put(setSaveBusyAction(false));
  }
}

export function* sendRequestToServer(timestamp: number = Date.now()): Generator<*, *, *> {
  const batch = yield select(state => state.save.queue);
  const compactBatch = compactUpdateActions(batch);
  const { version, tracingType, tracingId } = yield select(state => state.tracing);
  try {
    yield call(Request.sendJSONReceiveJSON,
      `/annotations/${tracingType}/${tracingId}?version=${version + 1}`, {
        method: "PUT",
        headers: { "X-Date": timestamp },
        data: compactBatch,
      });
    yield put(setVersionNumberAction(version + 1));
    yield put(setLastSaveTimestampAction());
    yield put(shiftSaveQueueAction(batch.length));
    yield call(toggleErrorHighlighting, false);
  } catch (error) {
    yield call(toggleErrorHighlighting, true);
    if (error.status >= 400 && error.status < 500) {
      app.router.off("beforeunload");
      // HTTP Code 409 'conflict' for dirty state
      if (error.status === 409) {
        yield call(alert, messages["save.failed_simultaneous_tracing"]);
      } else {
        yield call(alert, messages["save.failed_client_error"]);
      }
      app.router.reload();
      return;
    }
    yield delay(SAVE_RETRY_WAITING_TIME);
    yield call(sendRequestToServer);
  }
}

export function toggleErrorHighlighting(state: boolean) {
  if (document.body != null) {
    document.body.classList.toggle("save-error", state);
  }
  if (state) {
    Toast.error(messages["save.failed"], true);
  } else {
    Toast.delete("danger", messages["save.failed"]);
  }
}

// The Cantor pairing function assigns one natural number to each pair of natural numbers
function cantor(a, b) {
  return 0.5 * (a + b) * (a + b + 1) + b;
}

export function compactUpdateActions(updateActionsBatches: Array<Array<UpdateAction>>): Array<UpdateAction> {
  // This part of the code detects tree merges and splits.
  // It does so by identifying nodes and edges that were deleted in one tree only to be created
  // in another tree again afterwards.
  // It replaces the original deleteNode/createNode and deleteEdge/createEdge update actions
  // with a moveTreeComponent update action.
  // As one tree split can produce multiple new trees (if a branchpoint is deleted), the moved nodes
  // and edges have to be grouped by their old and new treeId. Then one moveTreeComponent update action
  // is inserted for each group, containing the respective moved node ids.
  // The exact spot where the moveTreeComponent update action is inserted is important. This is
  // described later.
  const result = updateActionsBatches.map((batch) => {
    let compactedBatch = [...batch];
    // Detect moved nodes and edges
    const movedNodesAndEdges = [];

    // Performance improvement: create a map of the deletedNode update actions, key is the nodeId
    const deleteNodeActionsMap = _.keyBy(batch, ua => ua.action === "deleteNode" ? ua.value.id : -1);
    // Performance improvement: create a map of the deletedEdge update actions, key is the cantor pairing
    // of sourceId and targetId
    const deleteEdgeActionsMap = _.keyBy(batch, ua => ua.action === "deleteEdge" ? cantor(ua.value.source, ua.value.target) : -1);
    for (const createUA of batch) {
      if (createUA.action === "createNode") {
        const deleteUA = deleteNodeActionsMap[createUA.value.id];
        if (deleteUA != null && deleteUA.action === "deleteNode" && deleteUA.value.treeId !== createUA.value.treeId) {
          movedNodesAndEdges.push([createUA, deleteUA]);
        }
      } else if (createUA.action === "createEdge") {
        const deleteUA = deleteEdgeActionsMap[cantor(createUA.value.source, createUA.value.target)];
        if (deleteUA != null && deleteUA.action === "deleteEdge" && deleteUA.value.treeId !== createUA.value.treeId) {
          movedNodesAndEdges.push([createUA, deleteUA]);
        }
      }
    }

    // Group moved nodes and edges by their old and new treeId using the cantor pairing function
    // to create a single unique id
    const groupedMovedNodesAndEdges = _.groupBy(movedNodesAndEdges, ([createUA, deleteUA]) =>
      cantor(createUA.value.treeId, deleteUA.value.treeId));

    // Create a moveTreeComponent update action for each of the groups and insert it at the right spot
    for (const movedPairings of _.values(groupedMovedNodesAndEdges)) {
      const oldTreeId = movedPairings[0][1].value.treeId;
      const newTreeId = movedPairings[0][0].value.treeId;
      const nodeIds = movedPairings
        .filter(([createUA]) => createUA.action === "createNode")
        .map(([createUA]) => createUA.value.id);
      // The moveTreeComponent update action needs to be placed:
      // BEFORE the possible deleteTree update action of the oldTreeId and
      // AFTER the possible createTree update action of the newTreeId
      const deleteTreeUAIndex = compactedBatch.findIndex(ua =>
        ua.action === "deleteTree" &&
        ua.value.id === oldTreeId);
      const createTreeUAIndex = compactedBatch.findIndex(ua =>
        ua.action === "createTree" &&
        ua.value.id === newTreeId);

      if (deleteTreeUAIndex > -1 && createTreeUAIndex > -1) {
        // This should not happen, but in case it does, the moveTreeComponent update action
        // cannot be inserted as the createTreeUA is after the deleteTreeUA
        // Skip the removal of the original create/delete update actions!
        continue;
      } else if (createTreeUAIndex > -1) {
        // Insert after the createTreeUA
        compactedBatch.splice(createTreeUAIndex + 1, 0, moveTreeComponent(oldTreeId, newTreeId, nodeIds));
      } else if (deleteTreeUAIndex > -1) {
        // Insert before the deleteTreeUA
        compactedBatch.splice(deleteTreeUAIndex, 0, moveTreeComponent(oldTreeId, newTreeId, nodeIds));
      } else {
        // Insert in front
        compactedBatch.unshift(moveTreeComponent(oldTreeId, newTreeId, nodeIds));
      }

      // Remove the original create/delete update actions of the moved nodes and edges
      compactedBatch = _.without(compactedBatch, ..._.flatten(movedPairings));
    }

    return compactedBatch;
  });


  // This part of the code removes all but the last updateTracing update actions
  let flatResult = _.flatten(result);
  const updateTracingUpdateActions = flatResult.filter(ua => ua.action === "updateTracing");
  if (updateTracingUpdateActions.length > 1) {
    flatResult = _.without(flatResult, ...updateTracingUpdateActions.slice(0, -1));
  }

  return flatResult;
}

export function performDiffTracing(
  prevTracing: TracingType,
  tracing: TracingType,
  flycam: FlycamType,
): Array<UpdateAction> {
  if (tracing.type === "skeleton" && prevTracing.type === "skeleton") {
    return Array.from(diffSkeletonTracing(prevTracing, tracing, flycam));
  } else if (tracing.type === "volume" && prevTracing.type === "volume") {
    return Array.from(diffVolumeTracing(prevTracing, tracing, flycam));
  } else {
    return [];
  }
}

export function* saveTracingAsync(): Generator<*, *, *> {
  const { initSkeleton } = yield race({
    initSkeleton: take("INITIALIZE_SKELETONTRACING"),
    initVolume: take("INITIALIZE_VOLUMETRACING"),
  });
  let prevTracing = yield select(state => state.tracing);
  if (initSkeleton) {
    if (yield select(state => state.tracing.activeTreeId == null)) {
      yield put(createTreeAction());
    }
  }
  yield take("WK_READY");
  const allowUpdate = yield select(state => state.tracing.restrictions.allowUpdate);
  if (!allowUpdate) return;

  while (true) {
    if (initSkeleton) {
      yield take([...SkeletonTracingActions, ...FlycamActions]);
    } else {
      yield take([...VolumeTracingSaveRelevantActions, ...FlycamActions]);
    }
    const tracing = yield select(state => state.tracing);
    const flycam = yield select(state => state.flycam);
    const items = Array.from(yield call(performDiffTracing,
      prevTracing, tracing, flycam));
    if (items.length > 0) {
      yield put(pushSaveQueueAction(items));
    }
    prevTracing = tracing;
  }
}
