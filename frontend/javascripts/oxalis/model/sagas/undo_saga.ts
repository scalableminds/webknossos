import createProgressCallback from "libs/progress_callback";
import Toast from "libs/toast";
import messages from "messages";
import { AnnotationToolEnum, type BucketAddress } from "oxalis/constants";
import { enforceSkeletonTracing } from "oxalis/model/accessors/skeletontracing_accessor";
import { getUserBoundingBoxesFromState } from "oxalis/model/accessors/tracing_accessor";
import {
  getVolumeTracingById,
  getVolumeTracingByLayerName,
  getVolumeTracings,
} from "oxalis/model/accessors/volumetracing_accessor";
import type { Action } from "oxalis/model/actions/actions";
import type { UserBoundingBoxAction } from "oxalis/model/actions/annotation_actions";
import {
  AllUserBoundingBoxActions,
  setUserBoundingBoxesAction,
} from "oxalis/model/actions/annotation_actions";
import type { RedoAction, UndoAction } from "oxalis/model/actions/save_actions";
import type { SkeletonTracingAction } from "oxalis/model/actions/skeletontracing_actions";
import {
  centerActiveNodeAction,
  setTracingAction,
  SkeletonTracingSaveRelevantActions,
} from "oxalis/model/actions/skeletontracing_actions";
import { setBusyBlockingInfoAction } from "oxalis/model/actions/ui_actions";
import {
  type AddBucketToUndoAction,
  type BatchUpdateGroupsAndSegmentsAction,
  cancelQuickSelectAction,
  type FinishAnnotationStrokeAction,
  type ImportVolumeTracingAction,
  type MaybeUnmergedBucketLoadedPromise,
  type RemoveSegmentAction,
  setSegmentGroupsAction,
  type SetSegmentGroupsAction,
  setSegmentsAction,
  type UpdateSegmentAction,
} from "oxalis/model/actions/volumetracing_actions";
import type { BucketDataArray } from "oxalis/model/bucket_data_handling/bucket";
import {
  compressTypedArray,
  decompressToTypedArray,
} from "oxalis/model/helpers/bucket_compression";
import type { Saga } from "oxalis/model/sagas/effect-generators";
import { select } from "oxalis/model/sagas/effect-generators";
import { UNDO_HISTORY_SIZE } from "oxalis/model/sagas/save_saga_constants";
import { Model } from "oxalis/singletons";
import type { SegmentGroup, SegmentMap, SkeletonTracing, UserBoundingBox } from "oxalis/store";
import type { Task } from "redux-saga";
import { actionChannel, all, call, delay, fork, join, put, take } from "typed-redux-saga";
import { ensureWkReady } from "./ready_sagas";

const UndoRedoRelevantBoundingBoxActions = AllUserBoundingBoxActions.filter(
  (action) => action !== "SET_USER_BOUNDING_BOXES",
);
type UndoBucket = {
  zoomedBucketAddress: BucketAddress;
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
  segmentGroups: SegmentGroup[];
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
  removeSegment?: RemoveSegmentAction;
  setSegmentGroups?: SetSegmentGroupsAction;
  batchUpdateGroupsAndSegments?: BatchUpdateGroupsAndSegmentsAction;
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
  } else if (action.type === "REMOVE_SEGMENT") {
    return {
      removeSegment: action,
    };
  } else if (action.type === "SET_SEGMENT_GROUPS") {
    return {
      setSegmentGroups: action,
    };
  } else if (action.type === "BATCH_UPDATE_GROUPS_AND_SEGMENTS") {
    return {
      batchUpdateGroupsAndSegments: action,
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

export function* manageUndoStates(): Saga<never> {
  // At its core, this saga maintains an undo and redo stack to implement
  // undo/redo functionality.
  const undoStack: Array<UndoState> = [];
  const redoStack: Array<UndoState> = [];

  // Declaration of local state necessary to manage the undo/redo mechanism.
  let previousAction: Action | null | undefined = null;
  let prevSkeletonTracingOrNull: SkeletonTracing | null | undefined = null;
  let prevUserBoundingBoxes: Array<UserBoundingBox> = [];
  let pendingCompressions: Array<Task> = [];
  const volumeInfoById: Record<
    string, // volume tracing id
    {
      // The set of volume buckets which were mutated during the current volume
      // operation (e.g., brushing). After a volume operation, the set is added
      // to the stack and cleared afterwards. This means the set is always
      // empty unless a volume operation is ongoing.
      currentVolumeUndoBuckets: VolumeUndoBuckets;
      // The "old" segment list that needs to be added to the next volume undo stack
      // entry so that that segment list can be restored upon undo.
      prevSegments: SegmentMap;
      prevSegmentGroups: SegmentGroup[];
    }
  > = {};

  yield* call(ensureWkReady);

  // Initialization of the local state variables from above.
  prevSkeletonTracingOrNull = yield* select((state) => state.tracing.skeleton);
  prevUserBoundingBoxes = yield* select(getUserBoundingBoxesFromState);
  const volumeTracings = yield* select((state) => getVolumeTracings(state.tracing));
  for (const volumeTracing of volumeTracings) {
    volumeInfoById[volumeTracing.tracingId] = {
      currentVolumeUndoBuckets: [],
      // Segments and SegmentGroups are always handled as immutable. So, no need to copy. If there's no volume
      // tracing, prevSegments can remain empty as it's not needed.
      prevSegments: volumeTracing.segments,
      prevSegmentGroups: volumeTracing.segmentGroups,
    };
  }

  // Helper functions for functionality related to volumeInfoById.
  function* setPrevSegmentsAndGroupsToCurrent() {
    // Read the current segments map and store it in volumeInfoById for all volume layers.
    const volumeTracings = yield* select((state) => getVolumeTracings(state.tracing));
    for (const volumeTracing of volumeTracings) {
      volumeInfoById[volumeTracing.tracingId].prevSegments = volumeTracing.segments;
      volumeInfoById[volumeTracing.tracingId].prevSegmentGroups = volumeTracing.segmentGroups;
    }
  }
  function* areCurrentVolumeUndoBucketsEmpty() {
    // Check that currentVolumeUndoBuckets is empty for all layers (see above for an
    // explanation of this invariant).
    // In case the invariant is violated for some reason, we forbid undo/redo.
    // The case can be provoked by brushing and hitting ctrl+z without lifting the
    // mouse button.
    const volumeTracings = yield* select((state) => getVolumeTracings(state.tracing));
    for (const volumeTracing of volumeTracings) {
      if (volumeInfoById[volumeTracing.tracingId].currentVolumeUndoBuckets.length > 0) {
        return false;
      }
    }
    return true;
  }

  const channel = yield* actionChannel([
    ...SkeletonTracingSaveRelevantActions,
    ...UndoRedoRelevantBoundingBoxActions,
    "ADD_BUCKET_TO_UNDO",
    "SET_SEGMENT_GROUPS",
    "FINISH_ANNOTATION_STROKE",
    "IMPORT_VOLUMETRACING",
    "UPDATE_SEGMENT",
    "REMOVE_SEGMENT",
    "UNDO",
    "REDO",
    "BATCH_UPDATE_GROUPS_AND_SEGMENTS",
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
      removeSegment,
      setSegmentGroups,
      batchUpdateGroupsAndSegments,
    } = unpackRelevantActionForUndo(currentAction);

    if (importVolumeTracingAction) {
      redoStack.splice(0);
      undoStack.splice(0);
      undoStack.push({
        type: "warning",
        reason: messages["undo.import_volume_tracing"],
      } as WarnUndoState);
    } else if (undo) {
      if (!(yield* call(areCurrentVolumeUndoBucketsEmpty))) {
        yield* call([Toast, Toast.warning], "Cannot redo at the moment. Please try again.");
        continue;
      }
      const wasInterpreted = yield* call(maybeInterpretUndoAsDiscardUiAction);
      if (!wasInterpreted) {
        previousAction = null;
        yield* call(
          applyStateOfStack,
          undoStack,
          redoStack,
          prevSkeletonTracingOrNull,
          prevUserBoundingBoxes,
          "undo",
        );

        // Since the current segments map changed, we need to update our reference to it.
        // Note that we don't need to do this for currentVolumeUndoBuckets, as this
        // was and is empty, anyway (due to the constraint we checked above).
        yield* call(setPrevSegmentsAndGroupsToCurrent);
      }

      if (undo.callback != null) {
        undo.callback();
      }

      yield* put(setBusyBlockingInfoAction(false));
    } else if (redo) {
      if (!(yield* call(areCurrentVolumeUndoBucketsEmpty))) {
        yield* call([Toast, Toast.warning], "Cannot redo at the moment. Please try again.");
        continue;
      }

      previousAction = null;
      yield* call(
        applyStateOfStack,
        redoStack,
        undoStack,
        prevSkeletonTracingOrNull,
        prevUserBoundingBoxes,
        "redo",
      );

      // See undo branch for an explanation.
      yield* call(setPrevSegmentsAndGroupsToCurrent);

      if (redo.callback != null) {
        redo.callback();
      }

      yield* put(setBusyBlockingInfoAction(false));
    } else {
      // The received action in this branch potentially causes a new
      // entry on the undo stack because the annotation was edited.

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
            segmentGroups: volumeInfo.prevSegmentGroups,
            tracingId: activeVolumeTracing.tracingId,
          },
        });
        // Segments and SegmentGroups are always handled as immutable. So, no need to copy.
        volumeInfo.prevSegments = activeVolumeTracing.segments;
        volumeInfo.prevSegmentGroups = activeVolumeTracing.segmentGroups;
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
      } else if (updateSegment || removeSegment) {
        // Updates to the segment list shouldn't necessarily create new undo states. In particular,
        // no new undo state is created when the updateSegment action is a byproduct of another
        // UI action (mainly by annotating with volume tools). Also, if a segment's anchor position is
        // updated automatically (e.g., by clicking), this should also not add another undo state.
        // On the other hand, a new undo state should be created when the user explicitly caused a
        // change to a segment. For example:
        // - by selecting/hovering a cell so that a new entry gets added to the list
        // - renaming or removing a segment
        // - changing the color of a segment
        const action = updateSegment || removeSegment;
        if (!action) {
          throw new Error("Unexpected action");
        }

        const createNewUndoState = removeSegment != null || updateSegment?.createsNewUndoState;
        if (createNewUndoState) {
          shouldClearRedoState = true;
          const activeVolumeTracing = yield* select((state) =>
            getVolumeTracingByLayerName(state.tracing, action.layerName),
          );
          if (activeVolumeTracing) {
            const volumeInfo = volumeInfoById[activeVolumeTracing.tracingId];
            undoStack.push({
              type: "volume",
              data: {
                buckets: [],
                segments: volumeInfo.prevSegments,
                segmentGroups: volumeInfo.prevSegmentGroups,
                tracingId: activeVolumeTracing.tracingId,
              },
            });
            // Segments and SegmentGroups are always handled as immutable. So, no need to copy.
            volumeInfo.prevSegments = activeVolumeTracing.segments;
            volumeInfo.prevSegmentGroups = activeVolumeTracing.segmentGroups;
          }
        } else {
          // Update most recent undo stack entry in-place.
          const volumeTracing = yield* select((state) =>
            getVolumeTracingByLayerName(state.tracing, action.layerName),
          );

          // If no volume tracing exists (but a segmentation layer exists, otherwise, the action wouldn't
          // have been dispatched), prevSegments doesn't need to be updated, as it's not used.
          if (volumeTracing != null) {
            const volumeInfo = volumeInfoById[volumeTracing.tracingId];
            volumeInfo.prevSegments = volumeTracing.segments;
            volumeInfo.prevSegmentGroups = volumeTracing.segmentGroups;
          }
        }
      } else if (setSegmentGroups || batchUpdateGroupsAndSegments) {
        if (setSegmentGroups?.calledFromUndoSaga) {
          // Ignore this action as it was dispatched from within this saga.
          continue;
        }
        shouldClearRedoState = true;
        const layerName =
          setSegmentGroups?.layerName || batchUpdateGroupsAndSegments?.payload[0].layerName;
        if (layerName == null) {
          throw new Error("Could not find layer name for action.");
        }
        const activeVolumeTracing = yield* select((state) =>
          getVolumeTracingByLayerName(state.tracing, layerName),
        );
        if (activeVolumeTracing) {
          const volumeInfo = volumeInfoById[activeVolumeTracing.tracingId];
          undoStack.push({
            type: "volume",
            data: {
              buckets: [],
              segments: volumeInfo.prevSegments,
              segmentGroups: volumeInfo.prevSegmentGroups,
              tracingId: activeVolumeTracing.tracingId,
            },
          });
          // Segments and SegmentGroups are always handled as immutable. So, no need to copy.
          volumeInfo.prevSegments = activeVolumeTracing.segments;
          volumeInfo.prevSegmentGroups = activeVolumeTracing.segmentGroups;
        }
      }

      if (shouldClearRedoState) {
        // Clear the redo stack when a new action is executed.
        redoStack.splice(0);
      }

      if (undoStack.length > UNDO_HISTORY_SIZE) {
        undoStack.shift();
      }
    }

    // We need the updated tracing here
    prevSkeletonTracingOrNull = yield* select((state) => state.tracing.skeleton);
    prevUserBoundingBoxes = yield* select(getUserBoundingBoxesFromState);
  }
}

function* maybeInterpretUndoAsDiscardUiAction() {
  // Sometimes the user hits undo because they want to undo something
  // which isn't really undoable yet. For example, the quick select preview
  // can be such a case.
  // In that case, we re-interpret the undo action accordingly.
  // The return value of this function signals whether undo was re-interpreted.
  const isQuickSelectActive = yield* select(
    (state) => state.uiInformation.quickSelectState === "active",
  );
  if (!isQuickSelectActive) {
    return false;
  }
  yield* put(cancelQuickSelectAction());
  return true;
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
  zoomedBucketAddress: BucketAddress,
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
  // The `set` operation is not problematic, since the BucketDataArray types
  // won't be mixed (either, they are BigInt or they aren't)
  // @ts-ignore
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
      const compressedBackendData = yield compressedBackendDataPromise;
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
  // Segments and SegmentGroups are always handled as immutable. So, no need to copy.
  const currentSegments = activeVolumeTracing.segments;
  const currentSegmentGroups = activeVolumeTracing.segmentGroups;
  // It's important to update the groups first, since the reducer for setSegments would
  // re-assign the group ids if segments belong to non-existent groups.
  yield* put(
    setSegmentGroupsAction(
      volumeAnnotationBatch.segmentGroups,
      volumeAnnotationBatch.tracingId,
      true,
    ),
  );
  yield* put(setSegmentsAction(volumeAnnotationBatch.segments, volumeAnnotationBatch.tracingId));
  cube.triggerPushQueue();
  return {
    type: "volume",
    data: {
      buckets: allCompressedBucketsOfCurrentState,
      segments: currentSegments,
      segmentGroups: currentSegmentGroups,
      tracingId: volumeAnnotationBatch.tracingId,
    },
  };
}

export default manageUndoStates;
