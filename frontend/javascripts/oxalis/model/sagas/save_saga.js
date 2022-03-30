// @flow
import { type Saga, type Task } from "redux-saga";

import type { Action } from "oxalis/model/actions/actions";
import {
  type AddBucketToUndoAction,
  type FinishAnnotationStrokeAction,
  type ImportVolumeTracingAction,
  type MaybeUnmergedBucketLoadedPromise,
  type UpdateSegmentAction,
  VolumeTracingSaveRelevantActions,
  type InitializeVolumeTracingAction,
  setSegmentsActions,
} from "oxalis/model/actions/volumetracing_actions";
import {
  AllUserBoundingBoxActions,
  setUserBoundingBoxesAction,
  type UserBoundingBoxAction,
} from "oxalis/model/actions/annotation_actions";
import { type BucketDataArray } from "oxalis/model/bucket_data_handling/bucket";
import { FlycamActions } from "oxalis/model/actions/flycam_actions";
import {
  PUSH_THROTTLE_TIME,
  SAVE_RETRY_WAITING_TIME,
  MAX_SAVE_RETRY_WAITING_TIME,
  UNDO_HISTORY_SIZE,
  maximumActionCountPerSave,
} from "oxalis/model/sagas/save_saga_constants";
import type {
  SkeletonTracing,
  Flycam,
  SaveQueueEntry,
  CameraData,
  UserBoundingBox,
  SegmentMap,
  VolumeTracing,
} from "oxalis/store";
import {
  type SkeletonTracingAction,
  SkeletonTracingSaveRelevantActions,
  centerActiveNodeAction,
  type InitializeSkeletonTracingAction,
  setTracingAction,
} from "oxalis/model/actions/skeletontracing_actions";
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
  _actionChannel,
  _all,
  _call,
  _delay,
  _take,
  _takeEvery,
  call,
  fork,
  join,
  put,
  race,
  select,
  take,
} from "oxalis/model/sagas/effect-generators";
import {
  compressTypedArray,
  decompressToTypedArray,
} from "oxalis/model/helpers/bucket_compression";
import { diffSkeletonTracing } from "oxalis/model/sagas/skeletontracing_saga";
import { diffVolumeTracing } from "oxalis/model/sagas/volumetracing_saga";
import { doWithToken } from "admin/admin_rest_api";
import { getResolutionInfo } from "oxalis/model/accessors/dataset_accessor";
import {
  getVolumeTracingById,
  getVolumeTracingByLayerName,
  getVolumeTracings,
} from "oxalis/model/accessors/volumetracing_accessor";
import { globalPositionToBucketPosition } from "oxalis/model/helpers/position_converter";
import {
  getUserBoundingBoxesFromState,
  selectTracing,
} from "oxalis/model/accessors/tracing_accessor";
import { selectQueue } from "oxalis/model/accessors/save_accessor";
import { setBusyBlockingInfoAction } from "oxalis/model/actions/ui_actions";
import Date from "libs/date";
import ErrorHandling from "libs/error_handling";
import Model from "oxalis/model";
import Request, { type RequestOptionsWithData } from "libs/request";
import Toast from "libs/toast";
import compactSaveQueue from "oxalis/model/helpers/compaction/compact_save_queue";
import compactUpdateActions from "oxalis/model/helpers/compaction/compact_update_actions";
import createProgressCallback from "libs/progress_callback";
import messages from "messages";
import window, { alert, document, location } from "libs/window";

import { enforceSkeletonTracing } from "../accessors/skeletontracing_accessor";

// This function is needed so that Flow is satisfied
// with how a mere promise is awaited within a saga.
function unpackPromise<T>(p: Promise<T>): Promise<T> {
  return p;
}

const UndoRedoRelevantBoundingBoxActions = AllUserBoundingBoxActions.filter(
  action => action !== "SET_USER_BOUNDING_BOXES",
);

type UndoBucket = {
  zoomedBucketAddress: Vector4,

  // The following arrays are Uint8Array due to the compression
  compressedData: Uint8Array,
  compressedBackendData?: Promise<Uint8Array>,

  maybeUnmergedBucketLoadedPromise: MaybeUnmergedBucketLoadedPromise,
  pendingOperations: Array<(BucketDataArray) => void>,
};
type VolumeUndoBuckets = Array<UndoBucket>;
type VolumeAnnotationBatch = {
  buckets: VolumeUndoBuckets,
  segments: SegmentMap,
  tracingId: string,
};
type SkeletonUndoState = { type: "skeleton", data: SkeletonTracing };
type VolumeUndoState = { type: "volume", data: VolumeAnnotationBatch };
type BoundingBoxUndoState = { type: "bounding_box", data: Array<UserBoundingBox> };
type WarnUndoState = { type: "warning", reason: string };
type UndoState = SkeletonUndoState | VolumeUndoState | BoundingBoxUndoState | WarnUndoState;

type RelevantActionsForUndoRedo = {
  skeletonUserAction?: SkeletonTracingAction,
  addBucketToUndoAction?: AddBucketToUndoAction,
  finishAnnotationStrokeAction?: FinishAnnotationStrokeAction,
  userBoundingBoxAction?: UserBoundingBoxAction,
  importVolumeTracingAction?: ImportVolumeTracingAction,
  undo?: UndoAction,
  redo?: RedoAction,
  updateSegment?: UpdateSegmentAction,
};

function unpackRelevantActionForUndo(action): RelevantActionsForUndoRedo {
  if (action.type === "ADD_BUCKET_TO_UNDO") {
    return {
      addBucketToUndoAction: action,
    };
  } else if (action.type === "FINISH_ANNOTATION_STROKE") {
    return {
      finishAnnotationStrokeAction: action,
    };
  } else if (action.type === "IMPORT_VOLUMETRACING") {
    return {
      importTracingAction: action,
    };
  } else if (action.type === "UNDO") {
    return {
      undo: action,
    };
  } else if (action.type === "REDO") {
    return {
      redo: action,
    };
  } else if (action.type === "UPDATE_SEGMENT") {
    return {
      updateSegment: action,
    };
  } else if (UndoRedoRelevantBoundingBoxActions.includes(action.type)) {
    return { userBoundingBoxAction: ((action: any): UserBoundingBoxAction) };
  }

  if (SkeletonTracingSaveRelevantActions.includes(action.type)) {
    return { skeletonUserAction: ((action: any): SkeletonTracingAction) };
  }

  throw new Error("Could not unpack redux action from channel");
}

export function* collectUndoStates(): Saga<void> {
  const undoStack: Array<UndoState> = [];
  const redoStack: Array<UndoState> = [];
  // This variable must be any (no Action) as otherwise cyclic dependencies are created which flow cannot handle.
  let previousAction: ?any = null;
  let prevSkeletonTracingOrNull: ?SkeletonTracing = null;
  let prevUserBoundingBoxes: Array<UserBoundingBox> = [];
  let pendingCompressions: Array<Task<void>> = [];

  const volumeInfoById: {
    [tracingId: string]: {
      currentVolumeUndoBuckets: VolumeUndoBuckets,
      prevSegments: SegmentMap,
    },
  } = {};

  yield* take("WK_READY");
  prevSkeletonTracingOrNull = yield* select(state => state.tracing.skeleton);
  prevUserBoundingBoxes = yield* select(getUserBoundingBoxesFromState);

  const volumeTracings = yield* select(state => getVolumeTracings(state.tracing));

  for (const volumeTracing of volumeTracings) {
    volumeInfoById[volumeTracing.tracingId] = {
      currentVolumeUndoBuckets: [],
      // The copy of the segment list that needs to be added to the next volume undo stack entry.
      // The SegmentMap is immutable. So, no need to copy. If there's no volume
      // tracing, prevSegments can remain empty as it's not needed.
      prevSegments: volumeTracing.segments,
    };
  }

  const actionChannel = yield _actionChannel([
    ...SkeletonTracingSaveRelevantActions,
    ...UndoRedoRelevantBoundingBoxActions,
    "ADD_BUCKET_TO_UNDO",
    "FINISH_ANNOTATION_STROKE",
    "IMPORT_VOLUMETRACING",
    "UPDATE_SEGMENT",
    "UNDO",
    "REDO",
  ]);

  let loopCounter = 0;
  while (true) {
    loopCounter++;
    if (loopCounter % 100 === 0) {
      // See https://github.com/scalableminds/webknossos/pull/6076 for an explanation
      // of this delay call.
      yield _delay(0);
    }
    const currentAction = yield* take(actionChannel);
    const {
      skeletonUserAction,
      addBucketToUndoAction,
      finishAnnotationStrokeAction,
      userBoundingBoxAction,
      importVolumeTracingAction,
      undo,
      redo,
      updateSegment,
    } = unpackRelevantActionForUndo(currentAction);
    if (
      skeletonUserAction ||
      addBucketToUndoAction ||
      finishAnnotationStrokeAction ||
      userBoundingBoxAction
    ) {
      let shouldClearRedoState = false;
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
        shouldClearRedoState = true;
        const {
          zoomedBucketAddress,
          bucketData,
          maybeUnmergedBucketLoadedPromise,
          pendingOperations,
          tracingId,
        } = addBucketToUndoAction;
        // The bucket's (old) state should be added to the undo
        // stack so that we can revert to its previous version.
        // bucketData is compressed asynchronously, which is why
        // the corresponding "task" is added to `pendingCompressions`.
        pendingCompressions.push(
          yield* fork(
            compressBucketAndAddToList,
            zoomedBucketAddress,
            bucketData,
            maybeUnmergedBucketLoadedPromise,
            pendingOperations,
            volumeInfoById[tracingId].currentVolumeUndoBuckets,
          ),
        );
      } else if (finishAnnotationStrokeAction) {
        // FINISH_ANNOTATION_STROKE was dispatched which marks the end
        // of a volume transaction.
        // All compression tasks (see `pendingCompressions`) need to be
        // awaited to add the proper entry to the undo stack.
        shouldClearRedoState = true;
        const activeVolumeTracing = yield* select(state =>
          getVolumeTracingById(state.tracing, finishAnnotationStrokeAction.tracingId),
        );
        yield* join(pendingCompressions);
        pendingCompressions = [];

        const volumeInfo = volumeInfoById[activeVolumeTracing.tracingId];
        undoStack.push({
          type: "volume",
          data: {
            buckets: volumeInfo.currentVolumeUndoBuckets,
            segments: volumeInfo.prevSegments,
            tracingId: activeVolumeTracing.tracingId,
          },
        });
        // The SegmentMap is immutable. So, no need to copy.
        volumeInfo.prevSegments = activeVolumeTracing.segments;
        volumeInfo.currentVolumeUndoBuckets = [];
      } else if (userBoundingBoxAction) {
        const boundingBoxUndoState = getBoundingBoxToUndoState(
          userBoundingBoxAction,
          prevUserBoundingBoxes,
          previousAction,
        );
        if (boundingBoxUndoState) {
          shouldClearRedoState = true;
          undoStack.push(boundingBoxUndoState);
        }
        previousAction = userBoundingBoxAction;
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
      previousAction = null;
      yield* call(
        applyStateOfStack,
        undoStack,
        redoStack,
        prevSkeletonTracingOrNull,
        prevUserBoundingBoxes,
        "undo",
      );
      if (undo.callback != null) {
        undo.callback();
      }
      yield* put(setBusyBlockingInfoAction(false));
    } else if (redo) {
      previousAction = null;
      yield* call(
        applyStateOfStack,
        redoStack,
        undoStack,
        prevSkeletonTracingOrNull,
        prevUserBoundingBoxes,
        "redo",
      );
      if (redo.callback != null) {
        redo.callback();
      }
      yield* put(setBusyBlockingInfoAction(false));
    } else if (updateSegment) {
      // Updates to the segment list should not create new undo states. Either, the segment list
      // was updated by annotating (then, that action will have caused a new undo state) or
      // the segment list was updated by selecting/hovering a cell (in that case, no new undo state
      // should be created, either).
      // If no volume tracing exists (but a segmentation layer exists, otherwise, the action wouldn't
      // have been dispatched), prevSegments doesn't need to be updated, as it's not used.
      const volumeTracing = yield* select(state =>
        getVolumeTracingByLayerName(state.tracing, updateSegment.layerName),
      );
      if (volumeTracing != null) {
        const volumeInfo = volumeInfoById[volumeTracing.tracingId];
        volumeInfo.prevSegments = volumeTracing.segments;
      }
    }
    // We need the updated tracing here
    prevSkeletonTracingOrNull = yield* select(state => state.tracing.skeleton);
    prevUserBoundingBoxes = yield* select(getUserBoundingBoxesFromState);
  }
}

function* getSkeletonTracingToUndoState(
  skeletonUserAction: SkeletonTracingAction,
  prevTracing: SkeletonTracing,
  previousAction: ?Action,
): Saga<?SkeletonUndoState> {
  const curTracing = yield* select(state => enforceSkeletonTracing(state.tracing));
  if (curTracing !== prevTracing) {
    if (shouldAddToUndoStack(skeletonUserAction, previousAction)) {
      return { type: "skeleton", data: prevTracing };
    }
  }
  return null;
}

function getBoundingBoxToUndoState(
  userBoundingBoxAction: UserBoundingBoxAction,
  prevUserBoundingBoxes: Array<UserBoundingBox>,
  previousAction: ?Action,
): ?BoundingBoxUndoState {
  const isSameActionOnSameBoundingBox =
    previousAction != null &&
    userBoundingBoxAction.id != null &&
    previousAction.id != null &&
    userBoundingBoxAction.type === previousAction.type &&
    userBoundingBoxAction.id === previousAction.id;
  // Used to distinguish between different resizing actions of the same bounding box.
  const isFinishedResizingAction =
    userBoundingBoxAction.type === "FINISHED_RESIZING_USER_BOUNDING_BOX";
  if (!isSameActionOnSameBoundingBox && !isFinishedResizingAction) {
    return { type: "bounding_box", data: prevUserBoundingBoxes };
  }
  return null;
}

function* compressBucketAndAddToList(
  zoomedBucketAddress: Vector4,
  bucketData: BucketDataArray,
  maybeUnmergedBucketLoadedPromise: MaybeUnmergedBucketLoadedPromise,
  pendingOperations: Array<(BucketDataArray) => void>,
  undoBucketList: VolumeUndoBuckets,
): Saga<void> {
  // The given bucket data is compressed, wrapped into a UndoBucket instance
  // and appended to the passed VolumeAnnotationBatch.
  // If backend data is being downloaded (MaybeUnmergedBucketLoadedPromise exists),
  // the backend data will also be compressed and attached to the UndoBucket.
  const compressedData = yield* call(compressTypedArray, bucketData);
  if (compressedData != null) {
    const volumeUndoPart: UndoBucket = {
      zoomedBucketAddress,
      compressedData,
      maybeUnmergedBucketLoadedPromise,
      pendingOperations: pendingOperations.slice(),
    };
    if (maybeUnmergedBucketLoadedPromise != null) {
      maybeUnmergedBucketLoadedPromise.then(backendBucketData => {
        // Once the backend data is fetched, do not directly merge it with the already saved undo data
        // as this operation is only needed, when the volume action is undone. Additionally merging is more
        // expensive than saving the backend data. Thus the data is only merged upon an undo action / when it is needed.
        volumeUndoPart.compressedBackendData = compressTypedArray(backendBucketData);
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
  prevUserBoundingBoxes: ?Array<UserBoundingBox>,
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
  } else if (stateToRestore.type === "bounding_box") {
    if (prevUserBoundingBoxes != null) {
      stackToPushTo.push({ type: "bounding_box", data: prevUserBoundingBoxes });
    }
    const newBoundingBoxes = stateToRestore.data;
    yield* put(setUserBoundingBoxesAction(newBoundingBoxes));
  } else if (stateToRestore.type === "warning") {
    Toast.info(stateToRestore.reason);
  }
}

function mergeDataWithBackendDataInPlace(
  originalData: BucketDataArray,
  backendData: BucketDataArray,
  pendingOperations: Array<(BucketDataArray) => void>,
) {
  if (originalData.length !== backendData.length) {
    throw new Error("Cannot merge data arrays with differing lengths");
  }

  // Transfer backend to originalData
  originalData.set(backendData);

  for (const op of pendingOperations) {
    op(originalData);
  }
}

function* applyAndGetRevertingVolumeBatch(
  volumeAnnotationBatch: VolumeAnnotationBatch,
): Saga<VolumeUndoState> {
  // Applies a VolumeAnnotationBatch and returns a VolumeUndoState (which simply wraps
  // another VolumeAnnotationBatch) for reverting the undo operation.

  const segmentationLayer = Model.getSegmentationTracingLayer(volumeAnnotationBatch.tracingId);
  if (!segmentationLayer) {
    throw new Error("Undoing a volume annotation but no volume layer exists.");
  }
  const { cube } = segmentationLayer;
  const allCompressedBucketsOfCurrentState: VolumeUndoBuckets = [];
  for (const volumeUndoBucket of volumeAnnotationBatch.buckets) {
    const {
      zoomedBucketAddress,
      compressedData: compressedBucketData,
      compressedBackendData: compressedBackendDataPromise,
    } = volumeUndoBucket;
    let { maybeUnmergedBucketLoadedPromise } = volumeUndoBucket;
    const bucket = cube.getOrCreateBucket(zoomedBucketAddress);
    if (bucket.type === "null") {
      continue;
    }

    // Prepare a snapshot of the bucket's current data so that it can be
    // saved in an VolumeUndoState.
    let bucketData = null;
    const currentPendingOperations = bucket.pendingOperations.slice();
    if (bucket.hasData()) {
      // The bucket's data is currently available.
      bucketData = bucket.getData();
      if (compressedBackendDataPromise != null) {
        // If the backend data for the bucket has been fetched in the meantime,
        // the previous getData() call already returned the newest (merged) data.
        // There should be no need to await the data from the backend.
        maybeUnmergedBucketLoadedPromise = null;
      }
    } else {
      // The bucket's data is not available, since it was gc'ed in the meantime (which
      // means its state must have been persisted to the server). Thus, it's enough to
      // persist an essentially empty data array (which is created by getOrCreateData)
      // and passing maybeUnmergedBucketLoadedPromise around so that
      // the back-end data is fetched upon undo/redo.
      bucketData = bucket.getOrCreateData();
      maybeUnmergedBucketLoadedPromise = bucket.maybeUnmergedBucketLoadedPromise;
    }

    // Append the compressed snapshot to allCompressedBucketsOfCurrentState.
    yield* call(
      compressBucketAndAddToList,
      zoomedBucketAddress,
      bucketData,
      maybeUnmergedBucketLoadedPromise,
      currentPendingOperations,
      allCompressedBucketsOfCurrentState,
    );

    // Decompress the bucket data which should be applied.
    let decompressedBucketData = null;
    let newPendingOperations = volumeUndoBucket.pendingOperations;

    if (compressedBackendDataPromise != null) {
      const compressedBackendData = yield* call(unpackPromise, compressedBackendDataPromise);

      let decompressedBackendData;
      [decompressedBucketData, decompressedBackendData] = yield _all([
        _call(decompressToTypedArray, bucket, compressedBucketData),
        _call(decompressToTypedArray, bucket, compressedBackendData),
      ]);

      mergeDataWithBackendDataInPlace(
        decompressedBucketData,
        decompressedBackendData,
        volumeUndoBucket.pendingOperations,
      );
      newPendingOperations = [];
    } else {
      decompressedBucketData = yield* call(decompressToTypedArray, bucket, compressedBucketData);
    }

    // Set the new bucket data to add the bucket directly to the pushqueue.
    cube.setBucketData(zoomedBucketAddress, decompressedBucketData, newPendingOperations);
  }

  const activeVolumeTracing = yield* select(state =>
    getVolumeTracingById(state.tracing, volumeAnnotationBatch.tracingId),
  );
  // The SegmentMap is immutable. So, no need to copy.
  const currentSegments = activeVolumeTracing.segments;

  yield* put(setSegmentsActions(volumeAnnotationBatch.segments, volumeAnnotationBatch.tracingId));
  cube.triggerPushQueue();

  return {
    type: "volume",
    data: {
      buckets: allCompressedBucketsOfCurrentState,
      segments: currentSegments,
      tracingId: volumeAnnotationBatch.tracingId,
    },
  };
}

export function* pushTracingTypeAsync(
  tracingType: "skeleton" | "volume",
  tracingId: string,
): Saga<void> {
  yield* take("WK_READY");

  yield* put(setLastSaveTimestampAction(tracingType, tracingId));

  let loopCounter = 0;
  while (true) {
    loopCounter++;

    let saveQueue;
    // Check whether the save queue is actually empty, the PUSH_SAVE_QUEUE_TRANSACTION action
    // could have been triggered during the call to sendRequestToServer

    saveQueue = yield* select(state => selectQueue(state, tracingType, tracingId));
    if (saveQueue.length === 0) {
      if (loopCounter % 100 === 0) {
        // See https://github.com/scalableminds/webknossos/pull/6076 for an explanation
        // of this delay call.
        yield _delay(0);
      }
      // Save queue is empty, wait for push event
      yield* take("PUSH_SAVE_QUEUE_TRANSACTION");
    }
    const { forcePush } = yield* race({
      timeout: _delay(PUSH_THROTTLE_TIME),
      forcePush: _take("SAVE_NOW"),
    });
    yield* put(setSaveBusyAction(true, tracingType));
    if (forcePush) {
      while (true) {
        // Send batches to the server until the save queue is empty.
        saveQueue = yield* select(state => selectQueue(state, tracingType, tracingId));
        if (saveQueue.length > 0) {
          yield* call(sendRequestToServer, tracingType, tracingId);
        } else {
          break;
        }
      }
    } else {
      saveQueue = yield* select(state => selectQueue(state, tracingType, tracingId));
      if (saveQueue.length > 0) {
        // Saving the tracing automatically (via timeout) only saves the current state.
        // It does not require to reach an empty saveQueue. This is especially
        // important when the auto-saving happens during continuous movements.
        // Always draining the save queue completely would mean that save
        // requests are sent as long as the user moves.
        yield* call(sendRequestToServer, tracingType, tracingId);
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

export function* sendRequestToServer(
  tracingType: "skeleton" | "volume",
  tracingId: string,
): Saga<void> {
  const fullSaveQueue = yield* select(state => selectQueue(state, tracingType, tracingId));
  const saveQueue = sliceAppropriateBatchCount(fullSaveQueue);
  let compactedSaveQueue = compactSaveQueue(saveQueue);
  const { version, type } = yield* select(state => selectTracing(state, tracingType, tracingId));
  const tracingStoreUrl = yield* select(state => state.tracing.tracingStore.url);
  compactedSaveQueue = addVersionNumbers(compactedSaveQueue, version);

  let retryCount = 0;
  while (true) {
    let exceptionDuringMarkBucketsAsNotDirty = false;
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

      yield* put(
        setVersionNumberAction(version + compactedSaveQueue.length, tracingType, tracingId),
      );
      yield* put(setLastSaveTimestampAction(tracingType, tracingId));
      yield* put(shiftSaveQueueAction(saveQueue.length, tracingType, tracingId));
      if (tracingType === "volume") {
        try {
          yield _call(markBucketsAsNotDirty, compactedSaveQueue, tracingId);
        } catch (error) {
          // If markBucketsAsNotDirty fails some reason, wk cannot recover from this error.
          console.warn("Error when marking buckets as clean. No retry possible. Error:", error);
          exceptionDuringMarkBucketsAsNotDirty = true;
          throw error;
        }
      }
      yield* call(toggleErrorHighlighting, false);
      return;
    } catch (error) {
      if (exceptionDuringMarkBucketsAsNotDirty) {
        throw error;
      }
      console.warn("Error during saving. Will retry. Error:", error);
      const controlMode = yield* select(state => state.temporaryConfiguration.controlMode);
      const isViewOrSandboxMode =
        controlMode === ControlModeEnum.VIEW || controlMode === ControlModeEnum.SANDBOX;
      if (!isViewOrSandboxMode) {
        // Notify user about error unless, view or sandbox mode is active. In that case,
        // we do not need to show the error as it is not so important and distracts the user.
        yield* call(toggleErrorHighlighting, true);
      }

      // Log the error to airbrake. Also compactedSaveQueue needs to be within an object
      // as otherwise the entries would be spread by the notify function.
      yield* call([ErrorHandling, ErrorHandling.notify], error, { compactedSaveQueue, retryCount });

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

function* markBucketsAsNotDirty(saveQueue: Array<SaveQueueEntry>, tracingId: string) {
  const segmentationLayer = Model.getSegmentationTracingLayer(tracingId);
  const segmentationResolutionInfo = yield* call(getResolutionInfo, segmentationLayer.resolutions);
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

export function toggleErrorHighlighting(state: boolean, permanentError: boolean = false): void {
  if (document.body != null) {
    document.body.classList.toggle("save-error", state);
  }
  const message = permanentError ? messages["save.failed.permanent"] : messages["save.failed"];
  if (state) {
    Toast.error(message, { sticky: true });
  } else {
    Toast.close(message);
  }
}

export function addVersionNumbers(
  updateActionsBatches: Array<SaveQueueEntry>,
  lastVersion: number,
): Array<SaveQueueEntry> {
  return updateActionsBatches.map(batch => ({ ...batch, version: ++lastVersion }));
}

export function performDiffTracing(
  prevTracing: SkeletonTracing | VolumeTracing,
  tracing: SkeletonTracing | VolumeTracing,
  prevFlycam: Flycam,
  flycam: Flycam,
  prevTdCamera: CameraData,
  tdCamera: CameraData,
): Array<UpdateAction> {
  let actions = [];
  if (prevTracing.type === "skeleton" && tracing.type === "skeleton") {
    actions = actions.concat(
      Array.from(diffSkeletonTracing(prevTracing, tracing, prevFlycam, flycam)),
    );
  }

  if (prevTracing.type === "volume" && tracing.type === "volume") {
    actions = actions.concat(
      Array.from(diffVolumeTracing(prevTracing, tracing, prevFlycam, flycam)),
    );
  }

  if (prevTdCamera !== tdCamera) {
    actions = actions.concat(updateTdCamera());
  }

  return actions;
}

export function* saveTracingAsync(): Saga<void> {
  yield _takeEvery("INITIALIZE_SKELETONTRACING", saveTracingTypeAsync);
  yield _takeEvery("INITIALIZE_VOLUMETRACING", saveTracingTypeAsync);
}

export function* saveTracingTypeAsync(
  initializeAction: InitializeSkeletonTracingAction | InitializeVolumeTracingAction,
): Saga<void> {
  /*
    Listen to changes to the annotation and derive UpdateActions from the
    old and new state.

    The actual push to the server is done by the forked pushTracingTypeAsync saga.
  */

  const tracingType =
    initializeAction.type === "INITIALIZE_SKELETONTRACING" ? "skeleton" : "volume";
  const tracingId = initializeAction.tracing.id;

  yield* fork(pushTracingTypeAsync, tracingType, tracingId);

  let prevTracing = yield* select(state => selectTracing(state, tracingType, tracingId));
  let prevFlycam = yield* select(state => state.flycam);
  let prevTdCamera = yield* select(state => state.viewModeData.plane.tdCamera);

  yield* take("WK_READY");

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
      state => state.tracing.restrictions.allowUpdate && state.tracing.restrictions.allowSave,
    );
    if (!allowUpdate) return;

    const tracing = yield* select(state => selectTracing(state, tracingType, tracingId));
    const flycam = yield* select(state => state.flycam);
    const tdCamera = yield* select(state => state.viewModeData.plane.tdCamera);
    const items = compactUpdateActions(
      // $FlowFixMe[incompatible-call] Should be resolved when we improve the typing of sagas in general
      Array.from(
        yield* call(
          performDiffTracing,
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
      yield* put(pushSaveQueueTransaction(items, tracingType, tracingId));
    }
    prevTracing = tracing;
    prevFlycam = flycam;
    prevTdCamera = tdCamera;
  }
}

export default [saveTracingAsync, collectUndoStates];
