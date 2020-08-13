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
import type { Tracing, SkeletonTracing, Flycam, SaveQueueEntry } from "oxalis/store";
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
  centerActiveNodeAction,
} from "oxalis/model/actions/skeletontracing_actions";
import type { Action } from "oxalis/model/actions/actions";
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
import type { Vector4 } from "oxalis/constants";
import compressStuff from "oxalis/workers/byte_array_to_lz4_base64_temp.worker";
import { createWorker } from "oxalis/workers/comlink_wrapper";

import { enforceSkeletonTracing } from "../accessors/skeletontracing_accessor";

const byteArrayToLz4Array = createWorker(compressStuff);

type UndoBucket = { zoomedBucketAddress: Vector4, data: Uint8Array };
type VolumeAnnotationBatch = Array<UndoBucket>;
type UndoState = { type: "skeleton" | "volume", data: SkeletonTracing | VolumeAnnotationBatch };

export function* collectUndoStates(): Saga<void> {
  const undoStack: Array<UndoState> = [];
  const redoStack: Array<UndoState> = [];
  let previousAction: ?Action = null;

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
        if (shouldAddToUndoStack(userAction, previousAction)) {
          undoStack.push({ type: "skeleton", data: prevTracing });
        }
        // Clear the redo stack when a new action is executed
        redoStack.splice(0);
        if (undoStack.length > UNDO_HISTORY_SIZE) undoStack.shift();
        previousAction = userAction;
      }
    } else if (undo) {
      if (undoStack.length) {
        previousAction = null;
        redoStack.push({ type: "skeleton", data: prevTracing });
        const newTracing = undoStack.pop().data;
        yield* put(setTracingAction(newTracing));
        yield* put(centerActiveNodeAction());
      } else {
        Toast.info(messages["undo.no_undo"]);
      }
    } else if (redo) {
      if (redoStack.length) {
        undoStack.push({ type: "skeleton", data: prevTracing });
        const newTracing = redoStack.pop().data;
        yield* put(setTracingAction(newTracing));
        yield* put(centerActiveNodeAction());
      } else {
        Toast.info(messages["undo.no_redo"]);
      }
    }
    // We need the updated tracing here
    prevTracing = yield* select(state => enforceSkeletonTracing(state.tracing));
  }
}

function* addAnnotationStrokeToUndoStack(undoStack: Array<UndoState>) {
  const bucketsOfCurrentStroke: VolumeAnnotationBatch = [];
  while (true) {
    const { addBucketToUndoAction, finishAnnotationStrokeAction } = yield* race({
      addBucketToUndoAction: _take("ADD_BUCKET_TO_UNDO"),
      finishAnnotationStrokeAction: _take("FINISH_ANNOTATION_STROKE"),
    });
    if (addBucketToUndoAction && addBucketToUndoAction.type === "ADD_BUCKET_TO_UNDO") {
      const { zoomedBucketAddress, bucketData } = addBucketToUndoAction;
      const bucketDataAsByteArray = new Uint8Array(
        bucketData.buffer,
        bucketData.byteOffset,
        bucketData.byteLength,
      );
      // TODO: use fork no not block this saga
      // TODO: use pure compress and decompress in a worker
      const compressedBucketData = yield* call(byteArrayToLz4Array, bucketDataAsByteArray);
      debugger;
      if (compressedBucketData != null) {
        bucketsOfCurrentStroke.push({ zoomedBucketAddress, data: compressedBucketData });
      }
    }
    if (finishAnnotationStrokeAction) {
      break;
    }
    undoStack.push({ type: "volume", data: bucketsOfCurrentStroke });
  }
}

function shouldAddToUndoStack(currentUserAction: Action, previousAction: ?Action) {
  if (previousAction == null) {
    return true;
  }
  switch (currentUserAction.type) {
    case "SET_NODE_POSITION": {
      // We do not need to save the previous state if the previous and this action both move the same node.
      // This causes the undo queue to only have the state before the node got moved and the state when moving the node finished.
      return !(
        previousAction.type === "SET_NODE_POSITION" &&
        currentUserAction.nodeId === previousAction.nodeId &&
        currentUserAction.treeId === previousAction.treeId
      );
    }
    default:
      return true;
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
          data: compactedSaveQueue,
          compress: true,
        },
      );
      const endTime = Date.now();
      if (endTime - startTime > PUSH_THROTTLE_TIME) {
        yield* call(
          [ErrorHandling, ErrorHandling.notify],
          new Error(
            `Warning: Save request took more than ${Math.ceil(PUSH_THROTTLE_TIME / 1000)} seconds.`,
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
        yield* call(
          [ErrorHandling, ErrorHandling.notify],
          new Error("Saving failed due to '409' status code"),
        );
        yield* call(alert, messages["save.failed_simultaneous_tracing"]);
        location.reload();
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
