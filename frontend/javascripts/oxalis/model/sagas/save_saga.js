/*
 * save_saga.js
 * @flow
 */

import { type Saga, type Task } from "redux-saga";
import Maybe from "data.maybe";

import { FlycamActions } from "oxalis/model/actions/flycam_actions";
import {
  PUSH_THROTTLE_TIME,
  SAVE_RETRY_WAITING_TIME,
  MAX_SAVE_RETRY_WAITING_TIME,
  UNDO_HISTORY_SIZE,
  maximumActionCountPerSave,
} from "oxalis/model/sagas/save_saga_constants";
import type { Tracing, SkeletonTracing, Flycam, SaveQueueEntry, CameraData } from "oxalis/store";
import { type UpdateAction, updateTdCamera } from "oxalis/model/sagas/update_actions";
import {
  VolumeTracingSaveRelevantActions,
  type AddBucketToUndoAction,
  type FinishAnnotationStrokeAction,
  type ImportVolumeTracingAction,
} from "oxalis/model/actions/volumetracing_actions";
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
  join,
  fork,
} from "oxalis/model/sagas/effect-generators";
import {
  SkeletonTracingSaveRelevantActions,
  type SkeletonTracingAction,
  setTracingAction,
  centerActiveNodeAction,
} from "oxalis/model/actions/skeletontracing_actions";
import { ViewModeSaveRelevantActions } from "oxalis/model/actions/view_mode_actions";
import type { Action } from "oxalis/model/actions/actions";
import { diffSkeletonTracing } from "oxalis/model/sagas/skeletontracing_saga";
import { diffVolumeTracing } from "oxalis/model/sagas/volumetracing_saga";
import { doWithToken } from "admin/admin_rest_api";
import {
  type UndoAction,
  type RedoAction,
  shiftSaveQueueAction,
  setSaveBusyAction,
  setLastSaveTimestampAction,
  pushSaveQueueTransaction,
  setVersionNumberAction,
} from "oxalis/model/actions/save_actions";
import Model from "oxalis/model";
import Date from "libs/date";
import Request, { type RequestOptionsWithData } from "libs/request";
import Toast from "libs/toast";
import compactSaveQueue from "oxalis/model/helpers/compaction/compact_save_queue";
import compactUpdateActions from "oxalis/model/helpers/compaction/compact_update_actions";
import messages from "messages";
import window, { alert, document, location } from "libs/window";
import ErrorHandling from "libs/error_handling";
import type { Vector4 } from "oxalis/constants";
import compressLz4Block from "oxalis/workers/byte_array_lz4_compression.worker";
import { createWorker } from "oxalis/workers/comlink_wrapper";
import {
  bucketsAlreadyInUndoState,
  type BucketDataArray,
} from "oxalis/model/bucket_data_handling/bucket";
import { enforceSkeletonTracing } from "../accessors/skeletontracing_accessor";

const byteArrayToLz4Array = createWorker(compressLz4Block);

type UndoBucket = { zoomedBucketAddress: Vector4, data: Uint8Array };
type VolumeAnnotationBatch = Array<UndoBucket>;
type SkeletonUndoState = { type: "skeleton", data: SkeletonTracing };
type VolumeUndoState = { type: "volume", data: VolumeAnnotationBatch };
type WarnUndoState = { type: "warning", reason: string };
type UndoState = SkeletonUndoState | VolumeUndoState | WarnUndoState;

type racedActionsNeededForUndoRedo = {
  skeletonUserAction: ?SkeletonTracingAction,
  addBucketToUndoAction: ?AddBucketToUndoAction,
  finishAnnotationStrokeAction: ?FinishAnnotationStrokeAction,
  importVolumeTracingAction: ?ImportVolumeTracingAction,
  undo: ?UndoAction,
  redo: ?RedoAction,
};

export function* collectUndoStates(): Saga<void> {
  const undoStack: Array<UndoState> = [];
  const redoStack: Array<UndoState> = [];
  let previousAction: ?any = null;
  let prevSkeletonTracingOrNull: ?SkeletonTracing = null;
  let pendingCompressions: Array<Task<void>> = [];
  let currentVolumeAnnotationBatch: VolumeAnnotationBatch = [];

  yield* take(["INITIALIZE_SKELETONTRACING", "INITIALIZE_VOLUMETRACING"]);
  prevSkeletonTracingOrNull = yield* select(state => state.tracing.skeleton);
  while (true) {
    const {
      skeletonUserAction,
      addBucketToUndoAction,
      finishAnnotationStrokeAction,
      importVolumeTracingAction,
      undo,
      redo,
    } = ((yield* race({
      skeletonUserAction: _take(SkeletonTracingSaveRelevantActions),
      addBucketToUndoAction: _take("ADD_BUCKET_TO_UNDO"),
      finishAnnotationStrokeAction: _take("FINISH_ANNOTATION_STROKE"),
      importTracingAction: _take("IMPORT_VOLUMETRACING"),
      undo: _take("UNDO"),
      redo: _take("REDO"),
    }): any): racedActionsNeededForUndoRedo);
    if (skeletonUserAction || addBucketToUndoAction || finishAnnotationStrokeAction) {
      let shouldClearRedoState =
        addBucketToUndoAction != null || finishAnnotationStrokeAction != null;
      if (skeletonUserAction && prevSkeletonTracingOrNull != null) {
        const skeletonUndoState = yield* call(
          getSkeletonTracingToUndoState,
          skeletonUserAction,
          prevSkeletonTracingOrNull,
          previousAction,
        );
        if (skeletonUndoState) {
          shouldClearRedoState = true;
          undoStack.push(skeletonUndoState);
        }
        previousAction = skeletonUserAction;
      } else if (addBucketToUndoAction) {
        const { zoomedBucketAddress, bucketData } = addBucketToUndoAction;
        pendingCompressions.push(
          yield* fork(
            compressBucketAndAddToUndoBatch,
            zoomedBucketAddress,
            bucketData,
            currentVolumeAnnotationBatch,
          ),
        );
      } else if (finishAnnotationStrokeAction) {
        yield* join([...pendingCompressions]);
        bucketsAlreadyInUndoState.clear();
        undoStack.push({ type: "volume", data: currentVolumeAnnotationBatch });
        currentVolumeAnnotationBatch = [];
        pendingCompressions = [];
      }
      if (shouldClearRedoState) {
        // Clear the redo stack when a new action is executed.
        redoStack.splice(0);
      }
      if (undoStack.length > UNDO_HISTORY_SIZE) {
        undoStack.shift();
      }
    } else if (importVolumeTracingAction) {
      redoStack.splice(0);
      undoStack.splice(0);
      undoStack.push(
        ({ type: "warning", reason: messages["undo.import_volume_tracing"] }: WarnUndoState),
      );
    } else if (undo) {
      if (undoStack.length > 0 && undoStack[undoStack.length - 1].type === "skeleton") {
        previousAction = null;
      }
      yield* call(
        applyStateOfStack,
        undoStack,
        redoStack,
        prevSkeletonTracingOrNull,
        messages["undo.no_undo"],
      );
    } else if (redo) {
      if (redoStack.length > 0 && redoStack[redoStack.length - 1].type === "skeleton") {
        previousAction = null;
      }
      yield* call(
        applyStateOfStack,
        redoStack,
        undoStack,
        prevSkeletonTracingOrNull,
        messages["undo.no_redo"],
      );
    }
    // We need the updated tracing here
    prevSkeletonTracingOrNull = yield* select(state => state.tracing.skeleton);
  }
}

function* getSkeletonTracingToUndoState(
  skeletonUserAction: SkeletonTracingAction,
  prevTracing: SkeletonTracing,
  previousAction: ?SkeletonTracingAction,
): Saga<?SkeletonUndoState> {
  const curTracing = yield* select(state => enforceSkeletonTracing(state.tracing));
  if (curTracing !== prevTracing) {
    if (shouldAddToUndoStack(skeletonUserAction, previousAction)) {
      return { type: "skeleton", data: prevTracing };
    }
  }
  return null;
}

function* compressBucketAndAddToUndoBatch(
  zoomedBucketAddress: Vector4,
  bucketData: BucketDataArray,
  undoBatch: VolumeAnnotationBatch,
): Saga<void> {
  const bucketDataAsByteArray = new Uint8Array(
    bucketData.buffer,
    bucketData.byteOffset,
    bucketData.byteLength,
  );
  const compressedBucketData = yield* call(byteArrayToLz4Array, bucketDataAsByteArray, true);
  if (compressedBucketData != null) {
    undoBatch.push({ zoomedBucketAddress, data: compressedBucketData });
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

function* applyStateOfStack(
  sourceStack: Array<UndoState>,
  stackToPushTo: Array<UndoState>,
  prevSkeletonTracingOrNull: ?SkeletonTracing,
  warningMessage: string,
): Saga<void> {
  if (sourceStack.length <= 0) {
    Toast.info(warningMessage);
    return;
  }
  const stateToRestore = sourceStack.pop();
  if (stateToRestore.type === "skeleton") {
    if (prevSkeletonTracingOrNull != null) {
      stackToPushTo.push({ type: "skeleton", data: prevSkeletonTracingOrNull });
    }
    const newTracing = stateToRestore.data;
    yield* put(setTracingAction(newTracing));
    yield* put(centerActiveNodeAction());
  } else if (stateToRestore.type === "volume") {
    const isMergerModeEnabled = yield* select(
      state => state.temporaryConfiguration.isMergerModeEnabled,
    );
    if (isMergerModeEnabled) {
      Toast.info(messages["tracing.edit_volume_in_merger_mode"]);
      sourceStack.push(stateToRestore);
      return;
    }
    const volumeBatchToApply = stateToRestore.data;
    const currentVolumeState = yield* call(applyAndGetRevertingVolumeBatch, volumeBatchToApply);
    stackToPushTo.push(currentVolumeState);
  } else if (stateToRestore.type === "warning") {
    Toast.info(stateToRestore.reason);
  }
}

function* applyAndGetRevertingVolumeBatch(
  volumeAnnotationBatch: VolumeAnnotationBatch,
): Saga<VolumeUndoState> {
  const segmentationLayer = Model.getSegmentationLayer();
  if (!segmentationLayer) {
    throw new Error("Undoing a volume annotation but no volume layer exists.");
  }
  const { cube } = segmentationLayer;
  const allCompressedBucketsOfCurrentState: VolumeAnnotationBatch = [];
  for (const { zoomedBucketAddress, data: compressedBucketData } of volumeAnnotationBatch) {
    const bucket = cube.getOrCreateBucket(zoomedBucketAddress);
    if (bucket.type === "null") {
      continue;
    }
    const bucketData = bucket.getData();
    yield* call(
      compressBucketAndAddToUndoBatch,
      zoomedBucketAddress,
      bucketData,
      allCompressedBucketsOfCurrentState,
    );
    const decompressedBucketData = yield* call(byteArrayToLz4Array, compressedBucketData, false);
    if (decompressedBucketData) {
      // Set the new bucket data to add the bucket directly to the pushqueue.
      cube.setBucketData(zoomedBucketAddress, decompressedBucketData);
    }
  }
  cube.triggerPushQueue();
  return {
    type: "volume",
    data: allCompressedBucketsOfCurrentState,
  };
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
      const annotationType = yield* select(state => state.tracing.annotationType);
      const isViewMode = annotationType === "View";
      if (!isViewMode) {
        // In view only mode we do not need to show the error as it is not so important and distracts the user.
        yield* call(toggleErrorHighlighting, true);
      }
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
  prevTdCamera: CameraData,
  tdCamera: CameraData,
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

  if (prevTdCamera !== tdCamera) {
    actions = actions.concat(updateTdCamera());
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
  let prevTdCamera = yield* select(state => state.viewModeData.plane.tdCamera);

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
      yield* take([
        ...SkeletonTracingSaveRelevantActions,
        ...FlycamActions,
        ...ViewModeSaveRelevantActions,
        "SET_TRACING",
      ]);
    } else {
      yield* take([
        ...VolumeTracingSaveRelevantActions,
        ...FlycamActions,
        ...ViewModeSaveRelevantActions,
      ]);
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
    const tdCamera = yield* select(state => state.viewModeData.plane.tdCamera);
    const items = compactUpdateActions(
      // $FlowFixMe[incompatible-call] Should be resolved when we improve the typing of sagas in general
      Array.from(
        yield* call(
          performDiffTracing,
          tracingType,
          prevTracing,
          tracing,
          prevFlycam,
          flycam,
          prevTdCamera,
          tdCamera,
        ),
      ),
      tracing,
    );
    if (items.length > 0) {
      yield* put(pushSaveQueueTransaction(items, tracingType));
    }
    prevTracing = tracing;
    prevFlycam = flycam;
    prevTdCamera = tdCamera;
  }
}
