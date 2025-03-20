import createProgressCallback from "libs/progress_callback";
import Toast from "libs/toast";
import messages from "messages";
import { AnnotationToolEnum } from "oxalis/constants";
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
  SkeletonTracingSaveRelevantActions,
  centerActiveNodeAction,
  setTracingAction,
} from "oxalis/model/actions/skeletontracing_actions";
import { setBusyBlockingInfoAction } from "oxalis/model/actions/ui_actions";
import {
  type AddBucketToUndoAction,
  type BatchUpdateGroupsAndSegmentsAction,
  type FinishAnnotationStrokeAction,
  type ImportVolumeTracingAction,
  type RemoveSegmentAction,
  type SetSegmentGroupsAction,
  type UpdateSegmentAction,
  cancelQuickSelectAction,
  setSegmentGroupsAction,
  setSegmentsAction,
} from "oxalis/model/actions/volumetracing_actions";
import type { Saga } from "oxalis/model/sagas/effect-generators";
import { select } from "oxalis/model/sagas/effect-generators";
import { UNDO_HISTORY_SIZE } from "oxalis/model/sagas/save_saga_constants";
import { Model } from "oxalis/singletons";
import type { SegmentGroup, SegmentMap, SkeletonTracing, UserBoundingBox } from "oxalis/store";
import { actionChannel, call, delay, put, take } from "typed-redux-saga";
import type BucketSnapshot from "../bucket_data_handling/bucket_snapshot";
import { ensureWkReady } from "./ready_sagas";

const UndoRedoRelevantBoundingBoxActions = AllUserBoundingBoxActions.filter(
  (action) => action !== "SET_USER_BOUNDING_BOXES",
);
type SkeletonUndoState = {
  type: "skeleton";
  data: SkeletonTracing;
};
type VolumeUndoState = {
  type: "volume";
  data: {
    buckets: BucketSnapshot[];
    segments: SegmentMap;
    segmentGroups: SegmentGroup[];
    tracingId: string;
  };
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
  const volumeInfoById: Record<
    string, // volume tracing id
    {
      // The set of volume buckets which were mutated during the current volume
      // operation (e.g., brushing). After a volume operation, the set is added
      // to the stack and cleared afterwards. This means the set is always
      // empty unless a volume operation is ongoing.
      currentBucketSnapshots: BucketSnapshot[];
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
      currentBucketSnapshots: [],
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
  function* areCurrentBucketSnapshotsEmpty() {
    // Check that currentBucketSnapshots is empty for all layers (see above for an
    // explanation of this invariant).
    // In case the invariant is violated for some reason, we forbid undo/redo.
    // The case can be provoked by brushing and hitting ctrl+z without lifting the
    // mouse button.
    const volumeTracings = yield* select((state) => getVolumeTracings(state.tracing));
    for (const volumeTracing of volumeTracings) {
      if (volumeInfoById[volumeTracing.tracingId].currentBucketSnapshots.length > 0) {
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
      if (!(yield* call(areCurrentBucketSnapshotsEmpty))) {
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
        // Note that we don't need to do this for currentBucketSnapshots, as this
        // was and is empty, anyway (due to the constraint we checked above).
        yield* call(setPrevSegmentsAndGroupsToCurrent);
      }

      if (undo.callback != null) {
        undo.callback();
      }

      yield* put(setBusyBlockingInfoAction(false));
    } else if (redo) {
      if (!(yield* call(areCurrentBucketSnapshotsEmpty))) {
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
        const { bucketSnapshot } = addBucketToUndoAction;
        // The bucket's (old) state should be added to the undo
        // stack so that we can revert to its previous version.
        const volumeInfo = volumeInfoById[bucketSnapshot.tracingId];
        volumeInfo.currentBucketSnapshots.push(bucketSnapshot);
      } else if (finishAnnotationStrokeAction) {
        // FINISH_ANNOTATION_STROKE was dispatched which marks the end
        // of a volume transaction.
        shouldClearRedoState = true;
        const activeVolumeTracing = yield* select((state) =>
          getVolumeTracingById(state.tracing, finishAnnotationStrokeAction.tracingId),
        );
        const volumeInfo = volumeInfoById[activeVolumeTracing.tracingId];
        undoStack.push({
          type: "volume",
          data: {
            buckets: volumeInfo.currentBucketSnapshots,
            segments: volumeInfo.prevSegments,
            segmentGroups: volumeInfo.prevSegmentGroups,
            tracingId: activeVolumeTracing.tracingId,
          },
        });
        // Segments and SegmentGroups are always handled as immutable. So, no need to copy.
        volumeInfo.prevSegments = activeVolumeTracing.segments;
        volumeInfo.prevSegmentGroups = activeVolumeTracing.segmentGroups;
        volumeInfo.currentBucketSnapshots = [];
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
    const currentVolumeState = yield* call(applyAndGetRevertingVolumeUndoState, stateToRestore);
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

function* applyAndGetRevertingVolumeUndoState(
  volumeUndoState: VolumeUndoState,
): Saga<VolumeUndoState> {
  // Applies a VolumeUndoState and returns a new VolumeUndoState for reverting the undo operation.
  const segmentationLayer = Model.getSegmentationTracingLayer(volumeUndoState.data.tracingId);

  if (!segmentationLayer) {
    throw new Error("Undoing a volume annotation but no volume layer exists.");
  }

  const { cube } = segmentationLayer;
  const allBucketSnapshotsForCurrentState: BucketSnapshot[] = [];

  yield* call(
    [Promise, Promise.all],
    volumeUndoState.data.buckets.map(async (bucketSnapshot) => {
      const bucket = cube.getOrCreateBucket(bucketSnapshot.zoomedAddress);

      if (bucket.type === "null") {
        return;
      }

      // Prepare a snapshot of the bucket's current data so that it can be
      // saved in an VolumeUndoState.
      const currentBucketSnapshot = await bucket.getSnapshotBeforeRestore();
      allBucketSnapshotsForCurrentState.push(currentBucketSnapshot);

      await bucket.restoreToSnapshot(bucketSnapshot);
    }),
  );

  const activeVolumeTracing = yield* select((state) =>
    getVolumeTracingById(state.tracing, volumeUndoState.data.tracingId),
  );
  // Segments and SegmentGroups are always handled as immutable. So, no need to copy.
  const currentSegments = activeVolumeTracing.segments;
  const currentSegmentGroups = activeVolumeTracing.segmentGroups;
  // It's important to update the groups first, since the reducer for setSegments would
  // re-assign the group ids if segments belong to non-existent groups.
  yield* put(
    setSegmentGroupsAction(
      volumeUndoState.data.segmentGroups,
      volumeUndoState.data.tracingId,
      true,
    ),
  );
  yield* put(setSegmentsAction(volumeUndoState.data.segments, volumeUndoState.data.tracingId));
  cube.triggerPushQueue();
  return {
    type: "volume",
    data: {
      buckets: allBucketSnapshotsForCurrentState,
      segments: currentSegments,
      segmentGroups: currentSegmentGroups,
      tracingId: volumeUndoState.data.tracingId,
    },
  };
}

export default manageUndoStates;
