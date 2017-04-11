/*
 * save_saga.js
 * @flow
 */

import _ from "lodash";
import $ from "jquery";
import app from "app";
import { call, put, take, select, race } from "redux-saga/effects";
import { delay } from "redux-saga";
import Request from "libs/request";
import { shiftSaveQueueAction, setSaveBusyAction, setLastSaveTimestampAction, pushSaveQueueAction, setVersionNumberAction } from "oxalis/model/actions/save_actions";
import { createTreeAction, SkeletonTracingActions } from "oxalis/model/actions/skeletontracing_actions";
import { FlycamActions } from "oxalis/model/actions/flycam_actions";
import messages from "messages";
import { alert } from "libs/window";
import { diffSkeletonTracing } from "oxalis/model/sagas/skeletontracing_saga";
import { diffVolumeTracing } from "oxalis/model/sagas/volumetracing_saga";
import type { UpdateAction } from "oxalis/model/sagas/update_actions";
import type { TracingType, FlycamType } from "oxalis/store";

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
    while (yield select(state => state.save.queue.length > 0)) {
      const batch = yield select(state => state.save.queue);
      const compactBatch = compactUpdateActions(batch);
      const { version, tracingType, tracingId } = yield select(state => state.tracing);
      try {
        yield call(Request.sendJSONReceiveJSON,
          `/annotations/${tracingType}/${tracingId}?version=${version + 1}`, {
            method: "PUT",
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
      }
    }
    yield put(setSaveBusyAction(false));
  }
}

function toggleErrorHighlighting(state: boolean) {
  $("body").toggleClass("save-error", state);
}

export function compactUpdateActions(updateActions: Array<UpdateAction>): Array<UpdateAction> {
  let result = updateActions;

  // Remove all but the last updateTracing update actions
  const updateTracingUpdateActions = result.filter(ua => ua.action === "updateTracing");
  if (updateTracingUpdateActions.length > 1) {
    result = _.without(result, ...updateTracingUpdateActions.slice(0, -1));
  }

  // // Detect moved nodes
  // const movedNodes = [];
  // for (const createUA of result) {
  //   if (createUA.action === "createNode") {
  //     const deleteUA = result.find(ua =>
  //       ua.action === "deleteNode" &&
  //       ua.value.id === createUA.value.id &&
  //       ua.value.treeId !== createUA.value.treeId);
  //     if (deleteUA != null) {
  //       movedNodes.push([createUA, deleteUA]);
  //     }
  //   }
  // }
  // for (const [createUA, deleteUA] of movedNodes) {
  //   moveTreeComponent(deleteUA.value.treeId, createUA.value.treeId, [createUA.value.id]);
  // }

  return result;
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
