/*
 * save_saga.js
 * @flow
 */

import _ from "lodash";
import $ from "jquery";
import Request from "libs/request";
import messages from "messages";
import app from "app";
import Toast from "libs/toast";
import { call, put, take, select, race } from "redux-saga/effects";
import { delay } from "redux-saga";
import { shiftSaveQueueAction, setSaveBusyAction, setLastSaveTimestampAction } from "oxalis/model/actions/save_actions";
import { setVersionNumber } from "oxalis/model/actions/skeletontracing_actions";
import { alert } from "libs/window";
import type { UpdateAction } from "oxalis/model/sagas/update_actions";

const PUSH_THROTTLE_TIME = 30000; // 30s
const SAVE_RETRY_WAITING_TIME = 5000;

export function* pushAnnotationAsync(): Generator<*, *, *> {
  yield take("INITIALIZE_SKELETONTRACING");
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
  const { version, tracingType, id: tracingId } = yield select(state => state.skeletonTracing);
  try {
    yield call(Request.sendJSONReceiveJSON,
      `/annotations/${tracingType}/${tracingId}?version=${version + 1}`, {
        method: "PUT",
        headers: { "X-Date": timestamp },
        data: compactBatch,
      });
    yield put(setVersionNumber(version + 1));
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
  $("body").toggleClass("save-error", state);
  if (state) {
    Toast.error(messages["save.failed"], true);
  } else {
    Toast.delete("danger", messages["save.failed"]);
  }
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
