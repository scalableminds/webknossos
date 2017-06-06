/*
 * save_saga.js
 * @flow
 */

import _ from "lodash";
import app from "app";
import Request from "libs/request";
import messages from "messages";
import Toast from "libs/toast";
import { call, put, take, select, race } from "redux-saga/effects";
import { delay } from "redux-saga";
import { shiftSaveQueueAction, setSaveBusyAction, setLastSaveTimestampAction, pushSaveQueueAction, setVersionNumberAction } from "oxalis/model/actions/save_actions";
import { createTreeAction, SkeletonTracingActions } from "oxalis/model/actions/skeletontracing_actions";
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

function cantor(a, b) {
  return 0.5 * (a + b) * (a + b + 1) + b;
}

export function compactUpdateActions(updateActionsBatches: Array<Array<UpdateAction>>): Array<UpdateAction> {
  let result = updateActionsBatches;

  result = result.map((batch) => {
    // Detect moved nodes and edges
    let compactedBatch = batch;
    const movedNodes = [];
    const movedEdgesUpdateActions = [];
    const deleteNodeActions = batch.filter(ua => ua.action === "deleteNode");
    const deleteEdgeActions = batch.filter(ua => ua.action === "deleteEdge");
    for (const createUA of batch) {
      if (createUA.action === "createNode") {
        const deleteUA = deleteNodeActions.find(ua =>
          // The first predicate will always be true, since we already filtered
          // for that, but we still need it here to satisfy flow :(
          ua.action === "deleteNode" &&
          ua.value.id === createUA.value.id &&
          ua.value.treeId !== createUA.value.treeId);
        if (deleteUA != null && deleteUA.action === "deleteNode") {
          movedNodes.push([createUA, deleteUA]);
        }
      } else if (createUA.action === "createEdge") {
        const deleteUA = deleteEdgeActions.find(ua =>
          // The first predicate will always be true, since we already filtered
          // for that, but we still need it here to satisfy flow :(
          ua.action === "deleteEdge" &&
          ua.value.source === createUA.value.source &&
          ua.value.target === createUA.value.target &&
          ua.value.treeId !== createUA.value.treeId);
        if (deleteUA != null) {
          movedEdgesUpdateActions.push(createUA, deleteUA);
        }
      }
    }

    // Group moved nodes by their old and new treeId using the cantor pairing function
    // to create a single unique id
    const groupedMovedNodes = _.groupBy(movedNodes, ([createUA, deleteUA]) =>
      cantor(createUA.value.treeId, deleteUA.value.treeId));

    // Create a moveTreeComponent update action for each of the groups and insert it at the right spot
    for (const movedPairings of _.values(groupedMovedNodes)) {
      const oldTreeId = movedPairings[0][1].value.treeId;
      const newTreeId = movedPairings[0][0].value.treeId;
      const nodeIds = movedPairings.map(([createUA]) => createUA.value.id);
      // The moveTreeComponent update action needs to be placed:
      // BEFORE the possible deleteTree update action of the oldTreeId and
      // AFTER the possible createTree update action of the newTreeId
      const deleteTreeUAIndex = compactedBatch.findIndex(ua =>
        ua.action === "deleteTree" &&
        ua.value.id === oldTreeId);
      const createTreeUAIndex = compactedBatch.findIndex(ua =>
        ua.action === "createTree" &&
        ua.value.id === newTreeId);
      console.log(deleteTreeUAIndex, createTreeUAIndex);
      if (deleteTreeUAIndex > -1 && createTreeUAIndex > -1) {
        // This should not happen, but in case it does, the moveTreeComponent update action
        // cannot be inserted as the createTreeUA is after the deleteTreeUA
        compactedBatch = _.without(compactedBatch, ..._.flatten(movedPairings));
        continue;
      } else if (createTreeUAIndex > -1) {
        // Insert after the createTreeUA
        compactedBatch = [
          ...compactedBatch.slice(0, createTreeUAIndex + 1),
          moveTreeComponent(oldTreeId, newTreeId, nodeIds),
          ...compactedBatch.slice(createTreeUAIndex + 1)];
      } else if (deleteTreeUAIndex > -1) {
        // Insert before the deleteTreeUA
        compactedBatch = [
          ...compactedBatch.slice(0, deleteTreeUAIndex),
          moveTreeComponent(oldTreeId, newTreeId, nodeIds),
          ...compactedBatch.slice(deleteTreeUAIndex)];
      } else {
        // Insert in front
        compactedBatch = [moveTreeComponent(oldTreeId, newTreeId, nodeIds), ...compactedBatch];
      }
    }

    // Remove the original create/delete update actions of the moved nodes and edges
    const movedNodesUpdateActions = _.flatten(movedNodes);
    return _.without(compactedBatch, ...movedNodesUpdateActions, ...movedEdgesUpdateActions);
  });


  // Remove all but the last updateTracing update actions
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
      yield take(FlycamActions);
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
