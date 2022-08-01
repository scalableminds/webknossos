import { Task } from "redux-saga";
import type { Saga } from "oxalis/model/sagas/effect-generators";
import type { Action } from "oxalis/model/actions/actions";
import type {
  AddBucketToUndoAction,
  FinishAnnotationStrokeAction,
  ImportVolumeTracingAction,
  MaybeUnmergedBucketLoadedPromise,
  UpdateSegmentAction,
  InitializeVolumeTracingAction,
  InitializeEditableMappingAction,
} from "oxalis/model/actions/volumetracing_actions";
import {
  VolumeTracingSaveRelevantActions,
  setSegmentsActions,
} from "oxalis/model/actions/volumetracing_actions";
import type { UserBoundingBoxAction } from "oxalis/model/actions/annotation_actions";
import {
  AllUserBoundingBoxActions,
  setUserBoundingBoxesAction,
} from "oxalis/model/actions/annotation_actions";
import type { BucketDataArray } from "oxalis/model/bucket_data_handling/bucket";
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
import type {
  SkeletonTracingAction,
  InitializeSkeletonTracingAction,
} from "oxalis/model/actions/skeletontracing_actions";
import {
  SkeletonTracingSaveRelevantActions,
  centerActiveNodeAction,
  setTracingAction,
} from "oxalis/model/actions/skeletontracing_actions";
import type { UndoAction, RedoAction, SaveQueueType } from "oxalis/model/actions/save_actions";
import {
  shiftSaveQueueAction,
  setSaveBusyAction,
  setLastSaveTimestampAction,
  pushSaveQueueTransaction,
  setVersionNumberAction,
} from "oxalis/model/actions/save_actions";
import type { UpdateAction } from "oxalis/model/sagas/update_actions";
import { updateTdCamera } from "oxalis/model/sagas/update_actions";
import { AnnotationToolEnum, type Vector4, ControlModeEnum } from "oxalis/constants";
import { ViewModeSaveRelevantActions } from "oxalis/model/actions/view_mode_actions";
import {
  actionChannel,
  all,
  delay,
  take,
  takeEvery,
  call,
  fork,
  join,
  put,
  race,
} from "typed-redux-saga";
import { select } from "oxalis/model/sagas/effect-generators";
import {
  compressTypedArray,
  decompressToTypedArray,
} from "oxalis/model/helpers/bucket_compression";
import { diffSkeletonTracing } from "oxalis/model/sagas/skeletontracing_saga";
import { diffVolumeTracing } from "oxalis/model/sagas/volumetracing_saga";
import { doWithToken, getNewestVersionForTracing } from "admin/admin_rest_api";
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
import type { RequestOptionsWithData } from "libs/request";
import Request from "libs/request";
import Toast from "libs/toast";
import compactSaveQueue from "oxalis/model/helpers/compaction/compact_save_queue";
import compactUpdateActions from "oxalis/model/helpers/compaction/compact_update_actions";
import createProgressCallback from "libs/progress_callback";
import messages from "messages";
import window, { alert, document, location } from "libs/window";
import { enforceSkeletonTracing } from "oxalis/model/accessors/skeletontracing_accessor";
import _ from "lodash";
import { sleep } from "libs/utils";
import { ensureWkReady } from "oxalis/model/sagas/wk_ready_saga";

const ONE_YEAR_MS = 365 * 24 * 3600 * 1000;

// This function is needed so that Flow is satisfied
// with how a mere promise is awaited within a saga.
function unpackPromise<T>(p: Promise<T>): Promise<T> {
  return p;
}

const UndoRedoRelevantBoundingBoxActions = AllUserBoundingBoxActions.filter(
  (action) => action !== "SET_USER_BOUNDING_BOXES",
);
type UndoBucket = {
  zoomedBucketAddress: Vector4;
  // The following arrays are Uint8Array due to the compression
  compressedData: Uint8Array;
  compressedBackendData?: Promise<Uint8Array>;
  maybeUnmergedBucketLoadedPromise: MaybeUnmergedBucketLoadedPromise;
  pendingOperations: Array<(arg0: BucketDataArray) => void>;
};
type VolumeUndoBuckets = Array<UndoBucket>;
type VolumeAnnotationBatch = {
  buckets: VolumeUndoBuckets;
  segments: SegmentMap;
  tracingId: string;
};
type SkeletonUndoState = {
  type: "skeleton";
  data: SkeletonTracing;
};
type VolumeUndoState = {
  type: "volume";
  data: VolumeAnnotationBatch;
};
type BoundingBoxUndoState = {
  type: "bounding_box";
  data: Array<UserBoundingBox>;
};
type WarnUndoState = {
  type: "warning";
  reason: string;
};
type UndoState = SkeletonUndoState | VolumeUndoState | BoundingBoxUndoState | WarnUndoState;
type RelevantActionsForUndoRedo = {
  skeletonUserAction?: SkeletonTracingAction;
  addBucketToUndoAction?: AddBucketToUndoAction;
  finishAnnotationStrokeAction?: FinishAnnotationStrokeAction;
  userBoundingBoxAction?: UserBoundingBoxAction;
  importVolumeTracingAction?: ImportVolumeTracingAction;
  undo?: UndoAction;
  redo?: RedoAction;
  updateSegment?: UpdateSegmentAction;
};

function unpackRelevantActionForUndo(action: Action): RelevantActionsForUndoRedo {
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
      importVolumeTracingAction: action,
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
    return {
      userBoundingBoxAction: action as any as UserBoundingBoxAction,
    };
  }

  if (SkeletonTracingSaveRelevantActions.includes(action.type)) {
    return {
      skeletonUserAction: action as any as SkeletonTracingAction,
    };
  }

  throw new Error("Could not unpack redux action from channel");
}

export function* collectUndoStates(): Saga<void> {
  const undoStack: Array<UndoState> = [];
  const redoStack: Array<UndoState> = [];
  // This variable must be any (no Action) as otherwise cyclic dependencies are created which flow cannot handle.
  let previousAction: any | null | undefined = null;
  let prevSkeletonTracingOrNull: SkeletonTracing | null | undefined = null;
  let prevUserBoundingBoxes: Array<UserBoundingBox> = [];
  let pendingCompressions: Array<Task> = [];
  const volumeInfoById: Record<
    string,
    {
      currentVolumeUndoBuckets: VolumeUndoBuckets;
      prevSegments: SegmentMap;
    }
  > = {};
  yield* take("WK_READY");
  prevSkeletonTracingOrNull = yield* select((state) => state.tracing.skeleton);
  prevUserBoundingBoxes = yield* select(getUserBoundingBoxesFromState);
  const volumeTracings = yield* select((state) => getVolumeTracings(state.tracing));

  for (const volumeTracing of volumeTracings) {
    volumeInfoById[volumeTracing.tracingId] = {
      currentVolumeUndoBuckets: [],
      // The copy of the segment list that needs to be added to the next volume undo stack entry.
      // The SegmentMap is immutable. So, no need to copy. If there's no volume
      // tracing, prevSegments can remain empty as it's not needed.
      prevSegments: volumeTracing.segments,
    };
  }

  const channel = yield* actionChannel([
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
      yield* delay(0);
    }

    const currentAction = yield* take(channel);
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
        const activeVolumeTracing = yield* select((state) =>
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
      undoStack.push({
        type: "warning",
        reason: messages["undo.import_volume_tracing"],
      } as WarnUndoState);
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
      const volumeTracing = yield* select((state) =>
        getVolumeTracingByLayerName(state.tracing, updateSegment.layerName),
      );

      if (volumeTracing != null) {
        const volumeInfo = volumeInfoById[volumeTracing.tracingId];
        volumeInfo.prevSegments = volumeTracing.segments;
      }
    }

    // We need the updated tracing here
    prevSkeletonTracingOrNull = yield* select((state) => state.tracing.skeleton);
    prevUserBoundingBoxes = yield* select(getUserBoundingBoxesFromState);
  }
}

function* getSkeletonTracingToUndoState(
  skeletonUserAction: SkeletonTracingAction,
  prevTracing: SkeletonTracing,
  previousAction: Action | null | undefined,
): Saga<SkeletonUndoState | null | undefined> {
  const curTracing = yield* select((state) => enforceSkeletonTracing(state.tracing));

  if (curTracing !== prevTracing) {
    if (shouldAddToUndoStack(skeletonUserAction, previousAction)) {
      return {
        type: "skeleton",
        data: prevTracing,
      };
    }
  }

  return null;
}

function getBoundingBoxToUndoState(
  userBoundingBoxAction: UserBoundingBoxAction,
  prevUserBoundingBoxes: Array<UserBoundingBox>,
  previousAction: Action | null | undefined,
): BoundingBoxUndoState | null | undefined {
  const isSameActionOnSameBoundingBox =
    previousAction != null &&
    "id" in userBoundingBoxAction &&
    "id" in previousAction &&
    userBoundingBoxAction.type === previousAction.type &&
    userBoundingBoxAction.id === previousAction.id;
  // Used to distinguish between different resizing actions of the same bounding box.
  const isFinishedResizingAction =
    userBoundingBoxAction.type === "FINISHED_RESIZING_USER_BOUNDING_BOX";

  if (!isSameActionOnSameBoundingBox && !isFinishedResizingAction) {
    return {
      type: "bounding_box",
      data: prevUserBoundingBoxes,
    };
  }

  return null;
}

function* compressBucketAndAddToList(
  zoomedBucketAddress: Vector4,
  bucketData: BucketDataArray,
  maybeUnmergedBucketLoadedPromise: MaybeUnmergedBucketLoadedPromise,
  pendingOperations: Array<(arg0: BucketDataArray) => void>,
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
      maybeUnmergedBucketLoadedPromise.then((backendBucketData) => {
        // Once the backend data is fetched, do not directly merge it with the already saved undo data
        // as this operation is only needed, when the volume action is undone. Additionally merging is more
        // expensive than saving the backend data. Thus the data is only merged upon an undo action / when it is needed.
        volumeUndoPart.compressedBackendData = compressTypedArray(backendBucketData);
      });
    }

    undoBucketList.push(volumeUndoPart);
  }
}

function shouldAddToUndoStack(
  currentUserAction: Action,
  previousAction: Action | null | undefined,
) {
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
  prevSkeletonTracingOrNull: SkeletonTracing | null | undefined,
  prevUserBoundingBoxes: Array<UserBoundingBox> | null | undefined,
  direction: "undo" | "redo",
): Saga<void> {
  if (sourceStack.length <= 0) {
    const warningMessage =
      direction === "undo" ? messages["undo.no_undo"] : messages["undo.no_redo"];
    Toast.info(warningMessage);
    return;
  }

  const activeTool = yield* select((state) => state.uiInformation.activeTool);
  if (activeTool === AnnotationToolEnum.PROOFREAD) {
    const warningMessage =
      direction === "undo"
        ? messages["undo.no_undo_during_proofread"]
        : messages["undo.no_redo_during_proofread"];
    Toast.warning(warningMessage);
    return;
  }

  const busyBlockingInfo = yield* select((state) => state.uiInformation.busyBlockingInfo);

  if (busyBlockingInfo.isBusy) {
    console.warn(`Ignoring ${direction} request (reason: ${busyBlockingInfo.reason || "null"})`);
    return;
  }

  yield* put(setBusyBlockingInfoAction(true, `${direction} is being performed.`));
  const stateToRestore = sourceStack.pop();
  if (stateToRestore == null) {
    // Emptiness of stack was already checked above. Satisfy typescript.
    return;
  }

  if (stateToRestore.type === "skeleton") {
    if (prevSkeletonTracingOrNull != null) {
      stackToPushTo.push({
        type: "skeleton",
        data: prevSkeletonTracingOrNull,
      });
    }

    const newTracing = stateToRestore.data;
    yield* put(setTracingAction(newTracing));
    yield* put(centerActiveNodeAction());
  } else if (stateToRestore.type === "volume") {
    const isMergerModeEnabled = yield* select(
      (state) => state.temporaryConfiguration.isMergerModeEnabled,
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
      stackToPushTo.push({
        type: "bounding_box",
        data: prevUserBoundingBoxes,
      });
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
  pendingOperations: Array<(arg0: BucketDataArray) => void>,
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
      const compressedBackendData = (yield* call(
        unpackPromise,
        compressedBackendDataPromise,
      )) as Uint8Array;
      let decompressedBackendData;
      [decompressedBucketData, decompressedBackendData] = yield* all([
        call(decompressToTypedArray, bucket, compressedBucketData),
        call(decompressToTypedArray, bucket, compressedBackendData),
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

  const activeVolumeTracing = yield* select((state) =>
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

export function* pushSaveQueueAsync(saveQueueType: SaveQueueType, tracingId: string): Saga<void> {
  yield* call(ensureWkReady);

  yield* put(setLastSaveTimestampAction(saveQueueType, tracingId));
  let loopCounter = 0;

  while (true) {
    loopCounter++;
    let saveQueue;
    // Check whether the save queue is actually empty, the PUSH_SAVE_QUEUE_TRANSACTION action
    // could have been triggered during the call to sendRequestToServer
    saveQueue = yield* select((state) => selectQueue(state, saveQueueType, tracingId));

    if (saveQueue.length === 0) {
      if (loopCounter % 100 === 0) {
        // See https://github.com/scalableminds/webknossos/pull/6076 for an explanation
        // of this delay call.
        yield* delay(0);
      }

      // Save queue is empty, wait for push event
      yield* take("PUSH_SAVE_QUEUE_TRANSACTION");
    }

    const { forcePush } = yield* race({
      timeout: delay(PUSH_THROTTLE_TIME),
      forcePush: take("SAVE_NOW"),
    });
    yield* put(setSaveBusyAction(true, saveQueueType));

    if (forcePush) {
      while (true) {
        // Send batches to the server until the save queue is empty.
        saveQueue = yield* select((state) => selectQueue(state, saveQueueType, tracingId));

        if (saveQueue.length > 0) {
          yield* call(sendRequestToServer, saveQueueType, tracingId);
        } else {
          break;
        }
      }
    } else {
      saveQueue = yield* select((state) => selectQueue(state, saveQueueType, tracingId));

      if (saveQueue.length > 0) {
        // Saving the tracing automatically (via timeout) only saves the current state.
        // It does not require to reach an empty saveQueue. This is especially
        // important when the auto-saving happens during continuous movements.
        // Always draining the save queue completely would mean that save
        // requests are sent as long as the user moves.
        yield* call(sendRequestToServer, saveQueueType, tracingId);
      }
    }

    yield* put(setSaveBusyAction(false, saveQueueType));
  }
}
export function sendRequestWithToken(
  urlWithoutToken: string,
  data: RequestOptionsWithData<Array<SaveQueueEntry>>,
): Promise<any> {
  return doWithToken((token) => Request.sendJSONReceiveJSON(`${urlWithoutToken}${token}`, data));
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

// The value for this boolean does not need to be restored to false
// at any time, because the browser page is reloaded after the message is shown, anyway.
let didShowFailedSimultaneousTracingError = false;

export function* sendRequestToServer(saveQueueType: SaveQueueType, tracingId: string): Saga<void> {
  const fullSaveQueue = yield* select((state) => selectQueue(state, saveQueueType, tracingId));
  const saveQueue = sliceAppropriateBatchCount(fullSaveQueue);
  let compactedSaveQueue = compactSaveQueue(saveQueue);
  const { version, type } = yield* select((state) =>
    selectTracing(state, saveQueueType, tracingId),
  );
  const tracingStoreUrl = yield* select((state) => state.tracing.tracingStore.url);
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
        setVersionNumberAction(version + compactedSaveQueue.length, saveQueueType, tracingId),
      );
      yield* put(setLastSaveTimestampAction(saveQueueType, tracingId));
      yield* put(shiftSaveQueueAction(saveQueue.length, saveQueueType, tracingId));

      if (saveQueueType === "volume") {
        try {
          yield* call(markBucketsAsNotDirty, compactedSaveQueue, tracingId);
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
      const controlMode = yield* select((state) => state.temporaryConfiguration.controlMode);
      const isViewOrSandboxMode =
        controlMode === ControlModeEnum.VIEW || controlMode === ControlModeEnum.SANDBOX;

      if (!isViewOrSandboxMode) {
        // Notify user about error unless, view or sandbox mode is active. In that case,
        // we do not need to show the error as it is not so important and distracts the user.
        yield* call(toggleErrorHighlighting, true);
      }

      // Log the error to airbrake. Also compactedSaveQueue needs to be within an object
      // as otherwise the entries would be spread by the notify function.
      // @ts-ignore
      yield* call({ context: ErrorHandling, fn: ErrorHandling.notify }, error, {
        compactedSaveQueue,
        retryCount,
      });

      // @ts-ignore
      if (error.status === 409) {
        // HTTP Code 409 'conflict' for dirty state
        // @ts-ignore
        window.onbeforeunload = null;
        yield* call(
          [ErrorHandling, ErrorHandling.notify],
          new Error("Saving failed due to '409' status code"),
        );
        if (!didShowFailedSimultaneousTracingError) {
          // If the saving fails for one tracing (e.g., skeleton), it can also
          // fail for another tracing (e.g., volume). The message simply tells the
          // user that the saving in general failed. So, there is no sense in showing
          // the message multiple times.
          yield* call(alert, messages["save.failed_simultaneous_tracing"]);
          location.reload();
          didShowFailedSimultaneousTracingError = true;
        }

        // Wait "forever" to avoid that the caller initiates other save calls afterwards (e.g.,
        // can happen if the caller tries to force-flush the save queue).
        // The reason we don't throw an error immediately is that this would immediately
        // crash all sagas (including saving other tracings).
        yield* call(sleep, ONE_YEAR_MS);
        throw new Error("Saving failed due to conflict.");
      }

      yield* race({
        timeout: delay(getRetryWaitTime(retryCount)),
        forcePush: take("SAVE_NOW"),
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
          const { position, mag } = updateAction.value;
          const resolutionIndex = segmentationResolutionInfo.getIndexByResolution(mag);
          const zoomedBucketAddress = globalPositionToBucketPosition(
            position,
            segmentationResolutionInfo.getDenseResolutions(),
            resolutionIndex,
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
    Toast.error(message, {
      sticky: true,
    });
  } else {
    Toast.close(message);
  }
}
export function addVersionNumbers(
  updateActionsBatches: Array<SaveQueueEntry>,
  lastVersion: number,
): Array<SaveQueueEntry> {
  return updateActionsBatches.map((batch) => ({ ...batch, version: ++lastVersion }));
}
export function performDiffTracing(
  prevTracing: SkeletonTracing | VolumeTracing,
  tracing: SkeletonTracing | VolumeTracing,
  prevFlycam: Flycam,
  flycam: Flycam,
  prevTdCamera: CameraData,
  tdCamera: CameraData,
): Array<UpdateAction> {
  let actions: Array<UpdateAction> = [];

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
  yield* takeEvery("INITIALIZE_SKELETONTRACING", setupSavingForTracingType);
  yield* takeEvery("INITIALIZE_VOLUMETRACING", setupSavingForTracingType);
  yield* takeEvery("INITIALIZE_EDITABLE_MAPPING", setupSavingForEditableMapping);
}

export function* setupSavingForEditableMapping(
  initializeAction: InitializeEditableMappingAction,
): Saga<void> {
  // No diffing needs to be done for editable mappings as the saga pushes update actions
  // to the respective save queues, itself
  const volumeTracingId = initializeAction.mapping.tracingId;
  yield* fork(pushSaveQueueAsync, "mapping", volumeTracingId);
}
export function* setupSavingForTracingType(
  initializeAction: InitializeSkeletonTracingAction | InitializeVolumeTracingAction,
): Saga<void> {
  /*
    Listen to changes to the annotation and derive UpdateActions from the
    old and new state.
     The actual push to the server is done by the forked pushSaveQueueAsync saga.
  */
  const saveQueueType =
    initializeAction.type === "INITIALIZE_SKELETONTRACING" ? "skeleton" : "volume";
  const tracingId = initializeAction.tracing.id;
  yield* fork(pushSaveQueueAsync, saveQueueType, tracingId);
  let prevTracing = (yield* select((state) => selectTracing(state, saveQueueType, tracingId))) as
    | VolumeTracing
    | SkeletonTracing;
  let prevFlycam = yield* select((state) => state.flycam);
  let prevTdCamera = yield* select((state) => state.viewModeData.plane.tdCamera);
  yield* take("WK_READY");

  while (true) {
    if (saveQueueType === "skeleton") {
      yield* take([
        ...SkeletonTracingSaveRelevantActions,
        ...FlycamActions,
        ...ViewModeSaveRelevantActions,
        // SET_TRACING is not included in SkeletonTracingSaveRelevantActions, because it is used by Undo/Redo and
        // should not create its own Undo/Redo stack entry
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
      (state) => state.tracing.restrictions.allowUpdate && state.tracing.restrictions.allowSave,
    );
    if (!allowUpdate) return;
    const tracing = (yield* select((state) => selectTracing(state, saveQueueType, tracingId))) as
      | VolumeTracing
      | SkeletonTracing;
    const flycam = yield* select((state) => state.flycam);
    const tdCamera = yield* select((state) => state.viewModeData.plane.tdCamera);
    const items = compactUpdateActions(
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
      yield* put(pushSaveQueueTransaction(items, saveQueueType, tracingId));
    }

    prevTracing = tracing;
    prevFlycam = flycam;
    prevTdCamera = tdCamera;
  }
}

const VERSION_POLL_INTERVAL_COLLAB = 10 * 1000;
const VERSION_POLL_INTERVAL_READ_ONLY = 60 * 1000;
const VERSION_POLL_INTERVAL_SINGLE_EDITOR = 30 * 1000;

function* watchForSaveConflicts() {
  function* checkForNewVersion() {
    const allowSave = yield* select((state) => state.tracing.restrictions.allowSave);

    const maybeSkeletonTracing = yield* select((state) => state.tracing.skeleton);
    const volumeTracings = yield* select((state) => state.tracing.volumes);
    const tracingStoreUrl = yield* select((state) => state.tracing.tracingStore.url);

    const tracings: Array<SkeletonTracing | VolumeTracing> = _.compact([
      ...volumeTracings,
      maybeSkeletonTracing,
    ]);

    for (const tracing of tracings) {
      const version = yield* call(
        getNewestVersionForTracing,
        tracingStoreUrl,
        tracing.tracingId,
        tracing.type,
      );

      if (version > tracing.version) {
        // The latest version on the server is greater than the most-recently
        // stored version.

        const saveQueue = yield* select((state) =>
          selectQueue(state, tracing.type, tracing.tracingId),
        );

        let msg = "";
        if (!allowSave) {
          msg =
            "A newer version of this annotation was found on the server. Reload the page to see the newest changes.";
        } else if (saveQueue.length > 0) {
          msg =
            "A newer version of this annotation was found on the server. Your current changes to this annotation cannot be saved, anymore.";
        } else {
          msg =
            "A newer version of this annotation was found on the server. Please reload the page to see the newer version. Otherwise, changes to the annotation cannot be saved, anymore.";
        }
        Toast.warning(msg, {
          sticky: true,
          key: "save_conflicts_warning",
        });
      }
    }
  }

  function* getPollInterval(): Saga<number> {
    const allowSave = yield* select((state) => state.tracing.restrictions.allowSave);
    if (!allowSave) {
      // The current user may not edit/save the annotation.
      return VERSION_POLL_INTERVAL_READ_ONLY;
    }

    const othersMayEdit = yield* select((state) => state.tracing.othersMayEdit);
    if (othersMayEdit) {
      // Other users may edit the annotation.
      return VERSION_POLL_INTERVAL_COLLAB;
    }

    // The current user is the only one who can edit the annotation.
    return VERSION_POLL_INTERVAL_SINGLE_EDITOR;
  }

  while (true) {
    const interval = yield* call(getPollInterval);
    yield* call(sleep, interval);
    try {
      yield* call(checkForNewVersion);
    } catch (exception) {
      // If the version check fails for some reason, we don't want to crash the entire
      // saga.
      console.warn(exception);
      // @ts-ignore
      ErrorHandling.notify(exception);
    }
  }
}

export default [saveTracingAsync, collectUndoStates, watchForSaveConflicts];
