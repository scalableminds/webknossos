/*
 * save_saga.js
 * @flow
 */

import { type Saga } from "redux-saga";
import Maybe from "data.maybe";

import { FlycamActions } from "oxalis/model/actions/flycam_actions";
import {
  PUSH_THROTTLE_TIME,
  SAVE_RETRY_WAITING_TIME,
  MAX_SAVE_RETRY_WAITING_TIME,
  UNDO_HISTORY_SIZE,
  maximumActionCountPerSave,
} from "oxalis/model/sagas/save_saga_constants";
import type { Tracing, Flycam, SaveQueueEntry } from "oxalis/store";
import { type UpdateAction } from "oxalis/model/sagas/update_actions";
import { VolumeTracingSaveRelevantActions } from "oxalis/model/actions/volumetracing_actions";
import {
  _all,
  _delay,
  take,
  _take,
  _call,
  race,
  call,
  put,
  select,
} from "oxalis/model/sagas/effect-generators";
import {
  SkeletonTracingSaveRelevantActions,
  setTracingAction,
} from "oxalis/model/actions/skeletontracing_actions";
import { diffSkeletonTracing } from "oxalis/model/sagas/skeletontracing_saga";
import { diffVolumeTracing } from "oxalis/model/sagas/volumetracing_saga";
import { doWithToken } from "admin/admin_rest_api";
import {
  shiftSaveQueueAction,
  setSaveBusyAction,
  setLastSaveTimestampAction,
  pushSaveQueueTransaction,
  setVersionNumberAction,
} from "oxalis/model/actions/save_actions";
import Date from "libs/date";
import Request, { type RequestOptionsWithData } from "libs/request";
import Toast from "libs/toast";
import compactSaveQueue from "oxalis/model/helpers/compaction/compact_save_queue";
import compactUpdateActions from "oxalis/model/helpers/compaction/compact_update_actions";
import messages from "messages";
import window, { alert, document, location } from "libs/window";
import ErrorHandling from "libs/error_handling";

import { enforceSkeletonTracing } from "../accessors/skeletontracing_accessor";

const SLOW_SAVE_REQUEST_THRESHOLD = 0.01; // 60 * 1000;

export function* collectUndoStates(): Saga<void> {
  const undoStack = [];
  const redoStack = [];

  yield* take("INITIALIZE_SKELETONTRACING");
  let prevTracing = yield* select(state => enforceSkeletonTracing(state.tracing));
  while (true) {
    const { userAction, undo, redo } = yield* race({
      userAction: _take(SkeletonTracingSaveRelevantActions),
      undo: _take("UNDO"),
      redo: _take("REDO"),
    });
    const curTracing = yield* select(state => enforceSkeletonTracing(state.tracing));
    if (userAction) {
      if (curTracing !== prevTracing) {
        // Clear the redo stack when a new action is executed
        redoStack.splice(0);
        undoStack.push(prevTracing);
        if (undoStack.length > UNDO_HISTORY_SIZE) undoStack.shift();
      }
    } else if (undo) {
      if (undoStack.length) {
        redoStack.push(prevTracing);
        const newTracing = undoStack.pop();
        yield* put(setTracingAction(newTracing));
      } else {
        Toast.info(messages["undo.no_undo"]);
      }
    } else if (redo) {
      if (redoStack.length) {
        undoStack.push(prevTracing);
        const newTracing = redoStack.pop();
        yield* put(setTracingAction(newTracing));
      } else {
        Toast.info(messages["undo.no_redo"]);
      }
    }
    // We need the updated tracing here
    prevTracing = yield* select(state => enforceSkeletonTracing(state.tracing));
  }
}

export function* pushAnnotationAsync(): Saga<void> {
  yield _all([_call(pushTracingTypeAsync, "skeleton"), _call(pushTracingTypeAsync, "volume")]);
}

export function* pushTracingTypeAsync(tracingType: "skeleton" | "volume"): Saga<void> {
  yield* take(
    tracingType === "skeleton" ? "INITIALIZE_SKELETONTRACING" : "INITIALIZE_VOLUMETRACING",
  );
  yield* put(setLastSaveTimestampAction(tracingType));
  while (true) {
    let saveQueue;
    // Check whether the save queue is actually empty, the PUSH_SAVE_QUEUE_TRANSACTION action
    // could have been triggered during the call to sendRequestToServer

    saveQueue = yield* select(state => state.save.queue[tracingType]);
    if (saveQueue.length === 0) {
      // Save queue is empty, wait for push event
      yield* take("PUSH_SAVE_QUEUE_TRANSACTION");
    }
    yield* race({
      timeout: _delay(PUSH_THROTTLE_TIME),
      forcePush: _take("SAVE_NOW"),
    });
    yield* put(setSaveBusyAction(true, tracingType));
    while (true) {
      // Send batches to the server until the save queue is empty
      saveQueue = yield* select(state => state.save.queue[tracingType]);
      if (saveQueue.length > 0) {
        yield* call(sendRequestToServer, tracingType);
      } else {
        break;
      }
    }
    yield* put(setSaveBusyAction(false, tracingType));
  }
}

export function sendRequestWithToken(
  urlWithoutToken: string,
  data: RequestOptionsWithData<Array<SaveQueueEntry>>,
): Promise<*> {
  return doWithToken(token => Request.sendJSONReceiveJSON(`${urlWithoutToken}${token}`, data));
}

// This function returns the first n batches of the provided array, so that the count of
// all actions in these n batches does not exceed maximumActionCountPerSave
function sliceAppropriateBatchCount(batches: Array<SaveQueueEntry>): Array<SaveQueueEntry> {
  const slicedBatches = [];
  let actionCount = 0;

  for (const batch of batches) {
    const newActionCount = actionCount + batch.actions.length;
    if (newActionCount <= maximumActionCountPerSave) {
      actionCount = newActionCount;
      slicedBatches.push(batch);
    } else {
      break;
    }
  }

  return slicedBatches;
}

function getRetryWaitTime(retryCount: number) {
  // Exponential backoff up until MAX_SAVE_RETRY_WAITING_TIME
  return Math.min(2 ** retryCount * SAVE_RETRY_WAITING_TIME, MAX_SAVE_RETRY_WAITING_TIME);
}

export function* sendRequestToServer(tracingType: "skeleton" | "volume"): Saga<void> {
  const fullSaveQueue = yield* select(state => state.save.queue[tracingType]);
  const saveQueue = sliceAppropriateBatchCount(fullSaveQueue);

  let compactedSaveQueue = compactSaveQueue(saveQueue);
  const { version, type, tracingId } = yield* select(state =>
    Maybe.fromNullable(state.tracing[tracingType]).get(),
  );
  const tracingStoreUrl = yield* select(state => state.tracing.tracingStore.url);
  compactedSaveQueue = addVersionNumbers(compactedSaveQueue, version);

  let retryCount = 0;
  while (true) {
    try {
      const startTime = Date.now();
      yield* call(
        sendRequestWithToken,
        `${tracingStoreUrl}/tracings/${type}/${tracingId}/update?token=`,
        {
          method: "POST",
          // headers: { "X-Date": `${Date.now()}` },
          data: compactedSaveQueue,
          compress: true,
        },
      );
      const endTime = Date.now();
      if (endTime - startTime > SLOW_SAVE_REQUEST_THRESHOLD) {
        yield* call(
          [ErrorHandling, ErrorHandling.notify],
          new Error(
            `Warning: Save request took more than ${Math.ceil(
              SLOW_SAVE_REQUEST_THRESHOLD / 1000,
            )} seconds.`,
          ),
        );
      }

      yield* put(setVersionNumberAction(version + compactedSaveQueue.length, tracingType));
      yield* put(setLastSaveTimestampAction(tracingType));
      yield* put(shiftSaveQueueAction(saveQueue.length, tracingType));
      yield* call(toggleErrorHighlighting, false);
      return;
    } catch (error) {
      yield* call(toggleErrorHighlighting, true);
      if (error.status === 409) {
        // HTTP Code 409 'conflict' for dirty state
        window.onbeforeunload = null;
        yield* call(alert, messages["save.failed_simultaneous_tracing"]);
        location.reload();
        yield* call(
          [ErrorHandling, ErrorHandling.notify],
          new Error("Saving failed due to '409' status code"),
        );
        return;
      }
      yield* race({
        timeout: _delay(getRetryWaitTime(retryCount)),
        forcePush: _take("SAVE_NOW"),
      });
      retryCount++;
    }
  }
}

export function toggleErrorHighlighting(state: boolean): void {
  if (document.body != null) {
    document.body.classList.toggle("save-error", state);
  }
  if (state) {
    Toast.error(messages["save.failed"], { sticky: true });
  } else {
    Toast.close(messages["save.failed"]);
  }
}

export function addVersionNumbers(
  updateActionsBatches: Array<SaveQueueEntry>,
  lastVersion: number,
): Array<SaveQueueEntry> {
  return updateActionsBatches.map(batch => Object.assign({}, batch, { version: ++lastVersion }));
}

export function performDiffTracing(
  tracingType: "skeleton" | "volume",
  prevTracing: Tracing,
  tracing: Tracing,
  prevFlycam: Flycam,
  flycam: Flycam,
): Array<UpdateAction> {
  let actions = [];
  if (tracingType === "skeleton" && tracing.skeleton != null && prevTracing.skeleton != null) {
    actions = actions.concat(
      Array.from(diffSkeletonTracing(prevTracing.skeleton, tracing.skeleton, prevFlycam, flycam)),
    );
  }

  if (tracingType === "volume" && tracing.volume != null && prevTracing.volume != null) {
    actions = actions.concat(
      Array.from(diffVolumeTracing(prevTracing.volume, tracing.volume, prevFlycam, flycam)),
    );
  }

  return actions;
}

export function* saveTracingAsync(): Saga<void> {
  yield _all([_call(saveTracingTypeAsync, "skeleton"), _call(saveTracingTypeAsync, "volume")]);
}

export function* saveTracingTypeAsync(tracingType: "skeleton" | "volume"): Saga<void> {
  yield* take(
    tracingType === "skeleton" ? "INITIALIZE_SKELETONTRACING" : "INITIALIZE_VOLUMETRACING",
  );

  let prevTracing = yield* select(state => state.tracing);
  let prevFlycam = yield* select(state => state.flycam);

  yield* take("WK_READY");
  const initialAllowUpdate = yield* select(
    state =>
      state.tracing[tracingType] &&
      state.tracing.restrictions.allowUpdate &&
      state.tracing.restrictions.allowSave,
  );
  if (!initialAllowUpdate) return;

  while (true) {
    if (tracingType === "skeleton") {
      yield* take([...SkeletonTracingSaveRelevantActions, ...FlycamActions, "SET_TRACING"]);
    } else {
      yield* take([...VolumeTracingSaveRelevantActions, ...FlycamActions]);
    }
    // The allowUpdate setting could have changed in the meantime
    const allowUpdate = yield* select(
      state =>
        state.tracing[tracingType] &&
        state.tracing.restrictions.allowUpdate &&
        state.tracing.restrictions.allowSave,
    );
    if (!allowUpdate) return;

    const tracing = yield* select(state => state.tracing);
    const flycam = yield* select(state => state.flycam);
    const items = compactUpdateActions(
      // $FlowFixMe: Should be resolved when we improve the typing of sagas in general
      Array.from(
        yield* call(performDiffTracing, tracingType, prevTracing, tracing, prevFlycam, flycam),
      ),
      tracing,
    );
    if (items.length > 0) {
      yield* put(pushSaveQueueTransaction(items, tracingType));
    }
    prevTracing = tracing;
    prevFlycam = flycam;
  }
}
