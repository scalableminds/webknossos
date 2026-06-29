/*
 * This module contains the sagas responsible for populating the save queue
 * with update actions that need to be saved to the server. Note that for proofreading,
 * the proofreading saga is directly responsible for filling the queue.
 */
import { buffers } from "redux-saga";
import { actionChannel, call, flush, put, race, take } from "typed-redux-saga";
import { mayAddToSaveQueue } from "viewer/model/accessors/annotation_accessor";
import { selectTracing } from "viewer/model/accessors/tracing_accessor";
import { FlycamActions } from "viewer/model/actions/flycam_actions";
import {
  type EnsureTracingsWereDiffedToSaveQueueAction,
  pushSaveQueueTransaction,
} from "viewer/model/actions/save_actions";
import type { InitializeSkeletonTracingAction } from "viewer/model/actions/skeletontracing_actions";
import { SkeletonTracingSaveRelevantActions } from "viewer/model/actions/skeletontracing_actions";
import { ViewModeSaveRelevantActions } from "viewer/model/actions/view_mode_actions";
import {
  type InitializeVolumeTracingAction,
  VolumeTracingSaveRelevantActions,
} from "viewer/model/actions/volumetracing_actions";
import compactUpdateActions from "viewer/model/helpers/compaction/compact_update_actions";
import { diffVolumeTracing } from "viewer/model/sagas/diffing/volume_diffing";
import type { Saga } from "viewer/model/sagas/effect_generators";
import { select } from "viewer/model/sagas/effect_generators";
import { ensureWkInitialized } from "viewer/model/sagas/ready_sagas";
import { diffSkeletonTracing } from "viewer/model/sagas/skeletontracing_saga";
import {
  type UpdateActionWithoutIsolationRequirement,
  updateCameraAnnotation,
  updateTdCamera,
} from "viewer/model/sagas/volume/update_actions";
import type {
  CameraData,
  Flycam,
  SkeletonTracing,
  VolumeTracing,
  WebknossosState,
} from "viewer/store";
import { getFlooredPosition, getRotationInDegrees } from "../../accessors/flycam_accessor";
import type { Action } from "../../actions/actions";
import type { BatchedAnnotationInitializationAction } from "../../actions/annotation_actions";

export function* setupSavingForAnnotation(
  _action: BatchedAnnotationInitializationAction,
): Saga<void> {
  yield* call(ensureWkInitialized);

  while (true) {
    let prevFlycam = yield* select((state) => state.flycam);
    let prevTdCamera = yield* select((state) => state.viewModeData.plane.tdCamera);
    yield* take([
      ...FlycamActions,
      ...ViewModeSaveRelevantActions,
      ...SkeletonTracingSaveRelevantActions,
    ]);
    const shouldDiff = yield* select(mayAddToSaveQueue);
    if (!shouldDiff) {
      // Note that we completely ignore changes if adding to save queue
      // is not allowed.
      continue;
    }
    const flycam = yield* select((state) => state.flycam);
    const tdCamera = yield* select((state) => state.viewModeData.plane.tdCamera);

    const items = Array.from(
      yield* call(performDiffAnnotation, prevFlycam, flycam, prevTdCamera, tdCamera),
    );

    if (items.length > 0) {
      yield* put(pushSaveQueueTransaction(items));
    }

    prevFlycam = flycam;
    prevTdCamera = tdCamera;
  }
}

export function* setupSavingForTracingType(
  initializeAction: InitializeSkeletonTracingAction | InitializeVolumeTracingAction,
): Saga<never> {
  /*
    Listen to changes to the annotation and derive UpdateActions from the
    old and new state.
    The actual push to the server is done by the forked pushSaveQueueAsync saga.
  */
  const tracingType =
    initializeAction.type === "INITIALIZE_SKELETONTRACING" ? "skeleton" : "volume";
  const tracingId = initializeAction.tracing.id;
  function* getTracing(): Generator<unknown, VolumeTracing | SkeletonTracing, WebknossosState> {
    return (yield* select((state) => selectTracing(state, tracingType, tracingId))) as
      | VolumeTracing
      | SkeletonTracing;
  }
  let prevTracing = yield* getTracing();

  yield* call(ensureWkInitialized);

  const tracingActionBuffer = buffers.expanding<Action>();
  const tracingActionChannel = yield* actionChannel(
    tracingType === "skeleton"
      ? [
          ...SkeletonTracingSaveRelevantActions,
          // SET_SKELETON_TRACING is not included in SkeletonTracingSaveRelevantActions, because it is used by Undo/Redo and
          // should not create its own Undo/Redo stack entry
          "SET_SKELETON_TRACING",
        ]
      : VolumeTracingSaveRelevantActions,
    tracingActionBuffer,
  );

  // During rebasing, the local users updates are replayed and thus the identity of skeleton nodes and edges in the diffable map entries change.
  // But content wise they should be the same. Thus, after rebasing reload the tracing to avoid diffs caused by the diffable map identity mismatches.
  // FINISHED_REBASING and FINISH_FORWARDING_UPDATE_ACTIONS actions are stored in the following
  // buffer.
  const finishedRebaseActionBuffer = buffers.expanding<Action>();
  const finishedRebaseActionChannel = yield* actionChannel(
    ["FINISHED_REBASING", "FINISH_FORWARDING_UPDATE_ACTIONS"],
    finishedRebaseActionBuffer,
  );

  // See Model.ensureSavedState for an explanation of this action channel.
  const ensureDiffedChannel = yield* actionChannel<EnsureTracingsWereDiffedToSaveQueueAction>(
    ["ENSURE_TRACINGS_WERE_DIFFED_TO_SAVE_QUEUE"],
    buffers.expanding<EnsureTracingsWereDiffedToSaveQueueAction>(1),
  );
  let ensureActions: EnsureTracingsWereDiffedToSaveQueueAction[] = [];
  function resolveEnsureDiffedActions() {
    for (const action of ensureActions) {
      action.callback(tracingId);
    }
    ensureActions = [];
  }

  while (true) {
    // Wait for either:
    // - a finished rebase/forwarding which needs to reset prevTracing
    // - a user action which requires diffing
    // - an "ensureAction" to confirm that diffing ran
    // The order of the race effect parameters is important, because it
    // defines the priority in case multiple takes are possible.
    // Concretely, if a rebase was finished, this needs to be taken care of
    // as a top priority.
    // Afterwards, we prioritize consumption of tracingActionChannel since we
    // don't want to eply to the ENSURE_TRACINGS_WERE_DIFFED_TO_SAVE_QUEUE action
    // if there are unprocessed user actions.
    const [finishedRebaseAction, _tracingAction, newEnsureAction] = yield* race([
      take(finishedRebaseActionChannel),
      take(tracingActionChannel),
      take(ensureDiffedChannel),
    ]);
    if (finishedRebaseAction != null) {
      yield* flush(finishedRebaseActionChannel);
      prevTracing = yield* getTracing();
      continue;
    }
    if (newEnsureAction != null) {
      // Consume entire channel so that we know which ensureActions we
      // can resolve after diffing. New "ensureActions" that might arrive
      // during diffing, will be buffered and should kick-off new diffing
      // in the next while-loop-iteration.
      const remainingActions = yield* flush(ensureDiffedChannel);

      // include the first action we already took from the race
      ensureActions = [
        newEnsureAction as EnsureTracingsWereDiffedToSaveQueueAction,
        ...remainingActions,
      ];
    }

    // We are about to diff old and new tracing to produce update actions
    // for the save queue. All buffered actions in tracingActionBuffer can
    // be flushed away, because it won't make sense to diff again when
    // `tracing` cannot have changed without a new tracingActionChannel entry.
    tracingActionBuffer.flush();

    const allowSave = yield* select(mayAddToSaveQueue);
    if (!allowSave) {
      yield* call(resolveEnsureDiffedActions);
      // Note that we completely ignore changes if adding to save queue
      // is not allowed.
      continue;
    }
    const tracing = yield* getTracing();

    const items = compactUpdateActions(
      Array.from(yield* call(performDiffTracing, prevTracing, tracing)),
      prevTracing,
      tracing,
    );

    if (items.length > 0) {
      yield* put(pushSaveQueueTransaction(items));
    }

    prevTracing = tracing;
    yield* call(resolveEnsureDiffedActions);
  }
}

function performDiffTracing(
  prevTracing: SkeletonTracing | VolumeTracing,
  tracing: SkeletonTracing | VolumeTracing,
): Array<UpdateActionWithoutIsolationRequirement> {
  let actions: Array<UpdateActionWithoutIsolationRequirement> = [];

  if (prevTracing.type === "skeleton" && tracing.type === "skeleton") {
    actions = actions.concat(Array.from(diffSkeletonTracing(prevTracing, tracing)));
  }

  if (prevTracing.type === "volume" && tracing.type === "volume") {
    actions = actions.concat(Array.from(diffVolumeTracing(prevTracing, tracing)));
  }

  return actions;
}

function performDiffAnnotation(
  prevFlycam: Flycam,
  flycam: Flycam,
  prevTdCamera: CameraData,
  tdCamera: CameraData,
): Array<UpdateActionWithoutIsolationRequirement> {
  let actions: Array<UpdateActionWithoutIsolationRequirement> = [];

  if (prevFlycam !== flycam) {
    actions = actions.concat(
      updateCameraAnnotation(
        getFlooredPosition(flycam),
        flycam.additionalCoordinates,
        getRotationInDegrees(flycam),
        flycam.zoomStep,
      ),
    );
  }

  if (prevTdCamera !== tdCamera) {
    actions = actions.concat(updateTdCamera());
  }

  return actions;
}
