/*
 * save_saga.js
 * @flow
 */

import { type Saga, type Task } from "redux-saga";
import Maybe from "data.maybe";

import _ from "lodash";
import type { Action } from "oxalis/model/actions/actions";
import { FlycamActions } from "oxalis/model/actions/flycam_actions";
import { enforceVolumeTracing } from "oxalis/model/accessors/volumetracing_accessor";
import {
  PUSH_THROTTLE_TIME,
  SAVE_RETRY_WAITING_TIME,
  MAX_SAVE_RETRY_WAITING_TIME,
  UNDO_HISTORY_SIZE,
  maximumActionCountPerSave,
} from "oxalis/model/sagas/save_saga_constants";
import {
  SkeletonTracingSaveRelevantActions,
  type SkeletonTracingAction,
  setTracingAction,
  centerActiveNodeAction,
} from "oxalis/model/actions/skeletontracing_actions";
import type {
  Tracing,
  SkeletonTracing,
  Flycam,
  SaveQueueEntry,
  CameraData,
  SegmentsMap,
} from "oxalis/store";
import createProgressCallback from "libs/progress_callback";
import { setBusyBlockingInfoAction } from "oxalis/model/actions/ui_actions";
import {
  type UndoAction,
  type RedoAction,
  shiftSaveQueueAction,
  setSaveBusyAction,
  setLastSaveTimestampAction,
  pushSaveQueueTransaction,
  setVersionNumberAction,
} from "oxalis/model/actions/save_actions";
import { type UpdateAction, updateTdCamera } from "oxalis/model/sagas/update_actions";
import { type Vector4, ControlModeEnum } from "oxalis/constants";
import { ViewModeSaveRelevantActions } from "oxalis/model/actions/view_mode_actions";
import {
  VolumeTracingSaveRelevantActions,
  setSegmentsActions,
  type AddBucketToUndoAction,
  type FinishAnnotationStrokeAction,
  type ImportVolumeTracingAction,
  type MaybeBucketLoadedPromise,
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
  _actionChannel,
} from "oxalis/model/sagas/effect-generators";
import {
  bucketsAlreadyInUndoState,
  type BucketDataArray,
} from "oxalis/model/bucket_data_handling/bucket";
import { createWorker } from "oxalis/workers/comlink_wrapper";
import { diffSkeletonTracing } from "oxalis/model/sagas/skeletontracing_saga";
import { diffVolumeTracing } from "oxalis/model/sagas/volumetracing_saga";
import { doWithToken } from "admin/admin_rest_api";
import { getResolutionInfoOfSegmentationTracingLayer } from "oxalis/model/accessors/dataset_accessor";
import { globalPositionToBucketPosition } from "oxalis/model/helpers/position_converter";
import Date from "libs/date";
import ErrorHandling from "libs/error_handling";
import Model from "oxalis/model";
import Request, { type RequestOptionsWithData } from "libs/request";
import Toast from "libs/toast";
import compactSaveQueue from "oxalis/model/helpers/compaction/compact_save_queue";
import compactUpdateActions from "oxalis/model/helpers/compaction/compact_update_actions";
import compressLz4Block from "oxalis/workers/byte_array_lz4_compression.worker";
import messages from "messages";
import window, { alert, document, location } from "libs/window";

import { enforceSkeletonTracing } from "../accessors/skeletontracing_accessor";

const byteArrayToLz4Array = createWorker(compressLz4Block);

type UndoBucket = {
  zoomedBucketAddress: Vector4,
  data: Uint8Array,
  backendData?: Uint8Array,
  maybeBucketLoadedPromise: MaybeBucketLoadedPromise,
};
type VolumeUndoBuckets = Array<UndoBucket>;
type VolumeAnnotationBatch = { buckets: VolumeUndoBuckets, segments: SegmentsMap };
type SkeletonUndoState = { type: "skeleton", data: SkeletonTracing };
type VolumeUndoState = { type: "volume", data: VolumeAnnotationBatch };
type WarnUndoState = { type: "warning", reason: string };
type UndoState = SkeletonUndoState | VolumeUndoState | WarnUndoState;

type RelevantActionsForUndoRedo = {
  skeletonUserAction?: SkeletonTracingAction,
  addBucketToUndoAction?: AddBucketToUndoAction,
  finishAnnotationStrokeAction?: FinishAnnotationStrokeAction,
  importVolumeTracingAction?: ImportVolumeTracingAction,
  undo?: UndoAction,
  redo?: RedoAction,
};

function unpackRelevantActionForUndo(action): RelevantActionsForUndoRedo {
  if (action.type === "ADD_BUCKET_TO_UNDO") {
    return {
      addBucketToUndoAction: action,
    };
  }

  if (action.type === "FINISH_ANNOTATION_STROKE") {
    return {
      finishAnnotationStrokeAction: action,
    };
  }
  if (action.type === "IMPORT_VOLUMETRACING") {
    return {
      importTracingAction: action,
    };
  }
  if (action.type === "UNDO") {
    return {
      undo: action,
    };
  }
  if (action.type === "REDO") {
    return {
      redo: action,
    };
  }

  if (SkeletonTracingSaveRelevantActions.includes(action.type)) {
    return {
      skeletonUserAction: ((action: any): SkeletonTracingAction),
    };
  }

  throw new Error("Could not unpack redux action from channel");
}

export function* collectUndoStates(): Saga<void> {
  const undoStack: Array<UndoState> = [];
  const redoStack: Array<UndoState> = [];
  let previousAction: ?any = null;
  let prevSkeletonTracingOrNull: ?SkeletonTracing = null;
  let pendingCompressions: Array<Task<void>> = [];
  let currentVolumeUndoBuckets: VolumeUndoBuckets = [];
  // The copy of the segment list that needs to be added to the next volume undo stack entry.
  let prevSegmentsList = new Map();

  yield* take(["INITIALIZE_SKELETONTRACING", "INITIALIZE_VOLUMETRACING"]);
  prevSkeletonTracingOrNull = yield* select(state => state.tracing.skeleton);
  const volumeTracingOrNull = yield* select(state => state.tracing.volume);
  if (volumeTracingOrNull != null) {
    const segments = yield* select(state => enforceVolumeTracing(state.tracing).segments);
    prevSegmentsList = _.cloneDeep(segments);
  }

  const actionChannel = yield _actionChannel([
    ...SkeletonTracingSaveRelevantActions,
    "ADD_BUCKET_TO_UNDO",
    "FINISH_ANNOTATION_STROKE",
    "IMPORT_VOLUMETRACING",
    "UNDO",
    "REDO",
  ]);
  while (true) {
    const currentAction = yield* take(actionChannel);

    const {
      skeletonUserAction,
      addBucketToUndoAction,
      finishAnnotationStrokeAction,
      importVolumeTracingAction,
      undo,
      redo,
    } = unpackRelevantActionForUndo(currentAction);

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
        const { zoomedBucketAddress, bucketData, maybeBucketLoadedPromise } = addBucketToUndoAction;
        pendingCompressions.push(
          yield* fork(
            compressBucketAndAddToList,
            zoomedBucketAddress,
            bucketData,
            maybeBucketLoadedPromise,
            currentVolumeUndoBuckets,
          ),
        );
      } else if (finishAnnotationStrokeAction) {
        yield* join([...pendingCompressions]);
        bucketsAlreadyInUndoState.clear();
        undoStack.push({
          type: "volume",
          data: { buckets: currentVolumeUndoBuckets, segments: prevSegmentsList },
        });
        const segments = yield* select(state => enforceVolumeTracing(state.tracing).segments);
        // Get a copy of the current segment list to be able to add it to the next upcoming volume undo stack entry.
        prevSegmentsList = _.cloneDeep(segments);
        currentVolumeUndoBuckets = [];
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
      yield* call(applyStateOfStack, undoStack, redoStack, prevSkeletonTracingOrNull, "undo");
      if (undo.callback != null) {
        undo.callback();
      }
      yield* put(setBusyBlockingInfoAction(false));
    } else if (redo) {
      if (redoStack.length > 0 && redoStack[redoStack.length - 1].type === "skeleton") {
        previousAction = null;
      }
      yield* call(applyStateOfStack, redoStack, undoStack, prevSkeletonTracingOrNull, "redo");
      if (redo.callback != null) {
        redo.callback();
      }
      yield* put(setBusyBlockingInfoAction(false));
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

function* compressBucketAndAddToList(
  zoomedBucketAddress: Vector4,
  bucketData: BucketDataArray,
  maybeBucketLoadedPromise: MaybeBucketLoadedPromise,
  undoBucketList: VolumeUndoBuckets,
): Saga<void> {
  // The given bucket data is compressed, wrapped into a UndoBucket instance
  // and appended to the passed VolumeAnnotationBatch.
  // If backend data is being downloaded (MaybeBucketLoadedPromise exists),
  // the backend data will also be compressed and attached to the UndoBucket.
  const bucketDataAsByteArray = new Uint8Array(
    bucketData.buffer,
    bucketData.byteOffset,
    bucketData.byteLength,
  );
  const compressedBucketData = yield* call(byteArrayToLz4Array, bucketDataAsByteArray, true);
  if (compressedBucketData != null) {
    const volumeUndoPart: UndoBucket = {
      zoomedBucketAddress,
      data: compressedBucketData,
      maybeBucketLoadedPromise,
    };
    if (maybeBucketLoadedPromise != null) {
      maybeBucketLoadedPromise.then(async backendBucketData => {
        // Once the backend data is fetched, do not directly merge it with the already saved undo data
        // as this operation is only needed, when the volume action is undone. Additionally merging is more
        // expensive than saving the backend data. Thus the data is only merged upon an undo action / when it is needed.
        const backendDataAsByteArray = new Uint8Array(
          backendBucketData.buffer,
          backendBucketData.byteOffset,
          backendBucketData.byteLength,
        );
        const compressedBackendData = await byteArrayToLz4Array(backendDataAsByteArray, true);
        volumeUndoPart.backendData = compressedBackendData;
      });
    }
    undoBucketList.push(volumeUndoPart);
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
  direction: "undo" | "redo",
): Saga<void> {
  if (sourceStack.length <= 0) {
    const warningMessage =
      direction === "undo" ? messages["undo.no_undo"] : messages["undo.no_redo"];

    Toast.info(warningMessage);
    return;
  }

  const busyBlockingInfo = yield* select(state => state.uiInformation.busyBlockingInfo);
  if (busyBlockingInfo.isBusy) {
    console.warn(`Ignoring ${direction} request (reason: ${busyBlockingInfo.reason || "null"})`);
    return;
  }

  yield* put(setBusyBlockingInfoAction(true, `${direction} is being performed.`));

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

    // Show progress information when undoing/redoing volume operations
    // since this can take some time (as data has to be downloaded
    // potentially).
    const progressCallback = createProgressCallback({
      pauseDelay: 100,
      successMessageDelay: 2000,
    });
    yield* call(progressCallback, false, `Performing ${direction}...`);

    const volumeBatchToApply = stateToRestore.data;
    const currentVolumeState = yield* call(applyAndGetRevertingVolumeBatch, volumeBatchToApply);
    stackToPushTo.push(currentVolumeState);
    yield* call(progressCallback, true, `Finished ${direction}...`);
  } else if (stateToRestore.type === "warning") {
    Toast.info(stateToRestore.reason);
  }
}

function mergeDataWithBackendDataInPlace(
  originalData: BucketDataArray,
  backendData: BucketDataArray,
) {
  for (let i = 0; i < originalData.length; ++i) {
    originalData[i] = originalData[i] || backendData[i];
  }
}

function* applyAndGetRevertingVolumeBatch(
  volumeAnnotationBatch: VolumeAnnotationBatch,
): Saga<VolumeUndoState> {
  // Applies a VolumeAnnotationBatch and returns a VolumeUndoState (which simply wraps
  // another VolumeAnnotationBatch) for reverting the undo operation.

  const segmentationLayer = Model.getSegmentationTracingLayer();
  if (!segmentationLayer) {
    throw new Error("Undoing a volume annotation but no volume layer exists.");
  }
  const { cube } = segmentationLayer;
  const allCompressedBucketsOfCurrentState: VolumeUndoBuckets = [];
  for (const volumeUndoBucket of volumeAnnotationBatch.buckets) {
    const {
      zoomedBucketAddress,
      data: compressedBucketData,
      backendData: compressedBackendData,
    } = volumeUndoBucket;
    let { maybeBucketLoadedPromise } = volumeUndoBucket;
    const bucket = cube.getOrCreateBucket(zoomedBucketAddress);
    if (bucket.type === "null") {
      continue;
    }

    // Prepare a snapshot of the bucket's current data so that it can be
    // saved in an VolumeUndoState.
    let bucketData = null;
    if (bucket.hasData()) {
      // The bucket's data is currently available.
      bucketData = bucket.getData();
      if (compressedBackendData != null) {
        // If the backend data for the bucket has been fetched in the meantime,
        // we can first merge the data with the current data and then add this to the undo batch.
        const decompressedBackendData = yield* call(
          byteArrayToLz4Array,
          compressedBackendData,
          false,
        );
        if (decompressedBackendData) {
          mergeDataWithBackendDataInPlace(bucketData, decompressedBackendData);
        }
        maybeBucketLoadedPromise = null;
      }
    } else {
      // The bucket's data is not available, since it was gc'ed in the meantime (which
      // means its state must have been persisted to the server). Thus, it's enough to
      // persist an essentially empty data array (which is created by getOrCreateData)
      // and passing maybeBucketLoadedPromise around so that
      // the back-end data is fetched upon undo/redo.
      bucketData = bucket.getOrCreateData().data;
      maybeBucketLoadedPromise = bucket.maybeBucketLoadedPromise;
    }

    // Append the compressed snapshot to allCompressedBucketsOfCurrentState.
    yield* call(
      compressBucketAndAddToList,
      zoomedBucketAddress,
      bucketData,
      maybeBucketLoadedPromise,
      allCompressedBucketsOfCurrentState,
    );

    // Decompress the bucket data which should be applied.
    let decompressedBucketData = null;
    if (compressedBackendData != null) {
      let decompressedBackendData;
      [decompressedBucketData, decompressedBackendData] = yield _all([
        _call(byteArrayToLz4Array, compressedBucketData, false),
        _call(byteArrayToLz4Array, compressedBackendData, false),
      ]);
      if (decompressedBucketData && decompressedBackendData) {
        mergeDataWithBackendDataInPlace(decompressedBucketData, decompressedBackendData);
      }
    } else {
      decompressedBucketData = yield* call(byteArrayToLz4Array, compressedBucketData, false);
    }
    if (decompressedBucketData) {
      // Set the new bucket data to add the bucket directly to the pushqueue.
      cube.setBucketData(zoomedBucketAddress, decompressedBucketData);
    }
  }
  const currentSegments = yield* select(state => enforceVolumeTracing(state.tracing).segments);
  const currentSegmentsCopy = _.cloneDeep(currentSegments);

  yield* put(setSegmentsActions(volumeAnnotationBatch.segments));
  cube.triggerPushQueue();

  return {
    type: "volume",
    data: { buckets: allCompressedBucketsOfCurrentState, segments: currentSegmentsCopy },
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
          compress: false, // todo: undo
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
      yield _call(markBucketsAsNotDirty, compactedSaveQueue);
      yield* call(toggleErrorHighlighting, false);
      return;
    } catch (error) {
      const controlMode = yield* select(state => state.temporaryConfiguration.controlMode);
      const isViewOrSandboxMode =
        controlMode === ControlModeEnum.VIEW || controlMode === ControlModeEnum.SANDBOX;
      if (!isViewOrSandboxMode) {
        // In view or sandbox mode we do not need to show the error as it is not so important and distracts the user.
        yield* call(toggleErrorHighlighting, true);
      } else {
        // Still log the error to airbrake. Also compactedSaveQueue needs to be within an object
        // as otherwise the entries would be spread by the notify function.
        yield* call([ErrorHandling, ErrorHandling.notify], error, { compactedSaveQueue });
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

function* markBucketsAsNotDirty(saveQueue: Array<SaveQueueEntry>) {
  const segmentationLayer = Model.getSegmentationTracingLayer();
  const dataset = yield* select(state => state.dataset);
  const segmentationResolutionInfo = getResolutionInfoOfSegmentationTracingLayer(dataset);
  if (segmentationLayer != null) {
    for (const saveEntry of saveQueue) {
      for (const updateAction of saveEntry.actions) {
        if (updateAction.name === "updateBucket") {
          const { position, zoomStep } = updateAction.value;
          const zoomedBucketAddress = globalPositionToBucketPosition(
            position,
            segmentationResolutionInfo.getDenseResolutions(),
            zoomStep,
          );
          const bucket = segmentationLayer.cube.getOrCreateBucket(zoomedBucketAddress);
          if (bucket.type === "null") {
            continue;
          }
          bucket.dirtyCount--;
          if (bucket.dirtyCount === 0) {
            bucket.markAsPushed();
          }
        }
      }
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
