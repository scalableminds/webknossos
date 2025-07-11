/*
 * This module contains the sagas responsible for populating the save queue
 * with update actions that need to be saved to the server. Note that for proofreading,
 * the proofreading saga is directly responsible for filling the queue.
 */

import { buffers } from "redux-saga";
import { actionChannel, call, put, race, take } from "typed-redux-saga";
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
import type { Saga } from "viewer/model/sagas/effect-generators";
import { select } from "viewer/model/sagas/effect-generators";
import { ensureWkReady } from "viewer/model/sagas/ready_sagas";
import { diffSkeletonTracing } from "viewer/model/sagas/skeletontracing_saga";
import {
  type UpdateActionWithoutIsolationRequirement,
  updateCameraAnnotation,
  updateTdCamera,
} from "viewer/model/sagas/volume/update_actions";
import { diffVolumeTracing } from "viewer/model/sagas/volumetracing_saga";
import type { CameraData, Flycam, SkeletonTracing, VolumeTracing } from "viewer/store";
import { getFlooredPosition, getRotationInDegrees } from "../../accessors/flycam_accessor";
import type { Action } from "../../actions/actions";
import type { BatchedAnnotationInitializationAction } from "../../actions/annotation_actions";

export function* setupSavingForAnnotation(
  _action: BatchedAnnotationInitializationAction,
): Saga<void> {
  yield* call(ensureWkReady);

  while (true) {
    let prevFlycam = yield* select((state) => state.flycam);
    let prevTdCamera = yield* select((state) => state.viewModeData.plane.tdCamera);
    yield* take([
      ...FlycamActions,
      ...ViewModeSaveRelevantActions,
      ...SkeletonTracingSaveRelevantActions,
    ]);
    // The allowUpdate setting could have changed in the meantime
    const allowUpdate = yield* select(
      (state) =>
        state.annotation.restrictions.allowUpdate && state.annotation.restrictions.allowSave,
    );
    if (!allowUpdate) continue;
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
  let prevTracing = (yield* select((state) => selectTracing(state, tracingType, tracingId))) as
    | VolumeTracing
    | SkeletonTracing;

  yield* call(ensureWkReady);

  const actionBuffer = buffers.expanding<Action>();
  const tracingActionChannel = yield* actionChannel(
    tracingType === "skeleton"
      ? [
          ...SkeletonTracingSaveRelevantActions,
          // SET_SKELETON_TRACING is not included in SkeletonTracingSaveRelevantActions, because it is used by Undo/Redo and
          // should not create its own Undo/Redo stack entry
          "SET_SKELETON_TRACING",
        ]
      : VolumeTracingSaveRelevantActions,
    actionBuffer,
  );

  // See Model.ensureSavedState for an explanation of this action channel.
  const ensureDiffedChannel = yield* actionChannel<EnsureTracingsWereDiffedToSaveQueueAction>(
    "ENSURE_TRACINGS_WERE_DIFFED_TO_SAVE_QUEUE",
  );

  while (true) {
    // Prioritize consumption of tracingActionChannel since we don't want to
    // reply to the ENSURE_TRACINGS_WERE_DIFFED_TO_SAVE_QUEUE action if there
    // are unprocessed user actions.
    if (!actionBuffer.isEmpty()) {
      yield* take(tracingActionChannel);
    } else {
      // Wait for either a user action or the "ensureAction".
      const { ensureAction } = yield* race({
        _tracingAction: take(tracingActionChannel),
        ensureAction: take(ensureDiffedChannel),
      });
      if (ensureAction != null) {
        ensureAction.callback(tracingId);
        continue;
      }
    }

    // The allowUpdate setting could have changed in the meantime
    const allowUpdate = yield* select(
      (state) =>
        state.annotation.restrictions.allowUpdate && state.annotation.restrictions.allowSave,
    );
    if (!allowUpdate) continue;
    const tracing = (yield* select((state) => selectTracing(state, tracingType, tracingId))) as
      | VolumeTracing
      | SkeletonTracing;

    const items = compactUpdateActions(
      Array.from(yield* call(performDiffTracing, prevTracing, tracing)),
      prevTracing,
      tracing,
    );

    if (items.length > 0) {
      yield* put(pushSaveQueueTransaction(items));
    }

    prevTracing = tracing;
  }
}

export function performDiffTracing(
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

export function performDiffAnnotation(
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
