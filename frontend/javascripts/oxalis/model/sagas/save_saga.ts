import { doWithToken, getNewestVersionForTracing } from "admin/admin_rest_api";
import Date from "libs/date";
import ErrorHandling from "libs/error_handling";
import type { RequestOptionsWithData } from "libs/request";
import Request from "libs/request";
import Toast from "libs/toast";
import { sleep } from "libs/utils";
import window, { alert, document, location } from "libs/window";
import _ from "lodash";
import messages from "messages";
import { ControlModeEnum } from "oxalis/constants";
import { getResolutionInfo } from "oxalis/model/accessors/dataset_accessor";
import { selectQueue } from "oxalis/model/accessors/save_accessor";
import { selectTracing } from "oxalis/model/accessors/tracing_accessor";
import { getVolumeTracingById } from "oxalis/model/accessors/volumetracing_accessor";
import { FlycamActions } from "oxalis/model/actions/flycam_actions";
import type { SaveQueueType } from "oxalis/model/actions/save_actions";
import {
  pushSaveQueueTransaction,
  setLastSaveTimestampAction,
  setSaveBusyAction,
  setVersionNumberAction,
  shiftSaveQueueAction,
} from "oxalis/model/actions/save_actions";
import type { InitializeSkeletonTracingAction } from "oxalis/model/actions/skeletontracing_actions";
import { SkeletonTracingSaveRelevantActions } from "oxalis/model/actions/skeletontracing_actions";
import { ViewModeSaveRelevantActions } from "oxalis/model/actions/view_mode_actions";
import {
  InitializeEditableMappingAction,
  InitializeVolumeTracingAction,
  VolumeTracingSaveRelevantActions,
} from "oxalis/model/actions/volumetracing_actions";
import compactSaveQueue from "oxalis/model/helpers/compaction/compact_save_queue";
import compactUpdateActions from "oxalis/model/helpers/compaction/compact_update_actions";
import { globalPositionToBucketPosition } from "oxalis/model/helpers/position_converter";
import type { Saga } from "oxalis/model/sagas/effect-generators";
import { select } from "oxalis/model/sagas/effect-generators";
import {
  MAXIMUM_ACTION_COUNT_PER_SAVE,
  MAX_SAVE_RETRY_WAITING_TIME,
  PUSH_THROTTLE_TIME,
  SAVE_RETRY_WAITING_TIME,
} from "oxalis/model/sagas/save_saga_constants";
import { diffSkeletonTracing } from "oxalis/model/sagas/skeletontracing_saga";
import type { UpdateAction } from "oxalis/model/sagas/update_actions";
import { updateTdCamera } from "oxalis/model/sagas/update_actions";
import { diffVolumeTracing } from "oxalis/model/sagas/volumetracing_saga";
import { ensureWkReady } from "oxalis/model/sagas/wk_ready_saga";
import { Model } from "oxalis/singletons";
import type {
  CameraData,
  Flycam,
  SaveQueueEntry,
  SkeletonTracing,
  VolumeTracing,
} from "oxalis/store";
import { call, delay, fork, put, race, take, takeEvery } from "typed-redux-saga";

const ONE_YEAR_MS = 365 * 24 * 3600 * 1000;

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
        // See https://github.com/scalableminds/webknossos/pull/6076 (or 82e16e1) for an explanation
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
    yield* put(setSaveBusyAction(true, saveQueueType, tracingId));

    // Send (parts) of the save queue to the server.
    // There are two main cases:
    // 1) forcePush is true
    //    The user explicitly requested to save an annotation.
    //    In this case, batches are sent to the server until the save
    //    queue is empty. Note that the save queue might be added to
    //    while saving is in progress. Still, the save queue will be
    //    drained until it is empty. If the user hits save and continuously
    //    annotates further, a high number of save-requests might be sent.
    // 2) forcePush is false
    //    The auto-save interval was reached at time T. The following code
    //    will determine how many items are in the save queue at this time T.
    //    Exactly that many items will be sent to the server.
    //    New items that might be added to the save queue during saving, will
    //    ignored (they will be picked up in the next iteration of this loop).
    //    Otherwise, the risk of a high number of save-requests (see case 1)
    //    would be present here, too (note the risk would be greater, because the
    //    user didn't use the save button which is usually accompanied a small pause).
    const itemCountToSave = forcePush
      ? Infinity
      : yield* select((state) => selectQueue(state, saveQueueType, tracingId).length);
    let savedItemCount = 0;
    while (savedItemCount < itemCountToSave) {
      saveQueue = yield* select((state) => selectQueue(state, saveQueueType, tracingId));

      if (saveQueue.length > 0) {
        savedItemCount += yield* call(sendRequestToServer, saveQueueType, tracingId);
      } else {
        break;
      }
    }

    yield* put(setSaveBusyAction(false, saveQueueType, tracingId));
  }
}
export function sendRequestWithToken(
  urlWithoutToken: string,
  data: RequestOptionsWithData<Array<SaveQueueEntry>>,
): Promise<any> {
  return doWithToken((token) => Request.sendJSONReceiveJSON(`${urlWithoutToken}${token}`, data));
}

// This function returns the first n batches of the provided array, so that the count of
// all actions in these n batches does not exceed MAXIMUM_ACTION_COUNT_PER_SAVE
function sliceAppropriateBatchCount(
  batches: Array<SaveQueueEntry>,
  saveQueueType: SaveQueueType,
): Array<SaveQueueEntry> {
  const slicedBatches = [];
  let actionCount = 0;

  for (const batch of batches) {
    const newActionCount = actionCount + batch.actions.length;

    if (newActionCount <= MAXIMUM_ACTION_COUNT_PER_SAVE[saveQueueType]) {
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

export function* sendRequestToServer(
  saveQueueType: SaveQueueType,
  tracingId: string,
): Saga<number> {
  /*
   * Saves a reasonably-sized part of the save queue (that corresponds to the
   * tracingId) to the server (plus retry-mechanism).
   * The saga returns the number of save queue items that were saved.
   */

  const fullSaveQueue = yield* select((state) => selectQueue(state, saveQueueType, tracingId));
  const saveQueue = sliceAppropriateBatchCount(fullSaveQueue, saveQueueType);
  let compactedSaveQueue = compactSaveQueue(saveQueue);
  const { version, type } = yield* select((state) =>
    selectTracing(state, saveQueueType, tracingId),
  );
  const tracingStoreUrl = yield* select((state) => state.tracing.tracingStore.url);
  let versionIncrement;
  [compactedSaveQueue, versionIncrement] = addVersionNumbers(compactedSaveQueue, version);
  let retryCount = 0;

  // This while-loop only exists for the purpose of a retry-mechanism
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
          compress: process.env.NODE_ENV === "production",
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

      yield* put(setVersionNumberAction(version + versionIncrement, saveQueueType, tracingId));
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
      return saveQueue.length;
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
          const { position, mag, additionalCoordinates } = updateAction.value;
          const resolutionIndex = segmentationResolutionInfo.getIndexByResolution(mag);
          const zoomedBucketAddress = globalPositionToBucketPosition(
            position,
            segmentationResolutionInfo.getDenseResolutions(),
            resolutionIndex,
            additionalCoordinates,
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
): [Array<SaveQueueEntry>, number] {
  let versionIncrement = 0;
  const batchesWithVersions = updateActionsBatches.map((batch) => {
    if (batch.transactionGroupIndex === 0) {
      versionIncrement++;
    }
    return { ...batch, version: lastVersion + versionIncrement };
  });
  return [batchesWithVersions, versionIncrement];
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
    if (!allowUpdate) continue;
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
    const allowSave = yield* select(
      (state) => state.tracing.restrictions.allowSave && state.tracing.restrictions.allowUpdate,
    );
    if (allowSave) {
      // The active user is currently the only one that is allowed to mutate the annotation.
      // Since we only acquire the mutex upon page load, there shouldn't be any unseen updates
      // between the page load and this check here.
      // A race condition where
      //   1) another user saves version X
      //   2) we load the annotation but only get see version X - 1 (this is the race)
      //   3) we acquire a mutex
      // should not occur, because there is a grace period for which the mutex has to be free until it can
      // be acquired again (see annotation.mutex.expiryTime in application.conf).
      // The downside of an early return here is that we won't be able to warn the user early
      // if the user opened the annotation in two tabs and mutated it there.
      // However,
      //   a) this scenario is pretty rare and the worst case is that they get a 409 error
      //      during saving and
      //   b) checking for newer versions when the active user may update the annotation introduces
      //      a race condition between this saga and the actual save saga. Synchronizing these sagas
      //      would be possible, but would add further complexity to the mission critical save saga.
      return;
    }

    const maybeSkeletonTracing = yield* select((state) => state.tracing.skeleton);
    const volumeTracings = yield* select((state) => state.tracing.volumes);
    const tracingStoreUrl = yield* select((state) => state.tracing.tracingStore.url);

    const tracings: Array<SkeletonTracing | VolumeTracing> = _.compact([
      ...volumeTracings,
      maybeSkeletonTracing,
    ]);

    for (const tracing of tracings) {
      const versionOnServer = yield* call(
        getNewestVersionForTracing,
        tracingStoreUrl,
        tracing.tracingId,
        tracing.type,
      );

      // Read the tracing version again from the store, since the
      // old reference to tracing might be outdated now due to the
      // immutability.
      const versionOnClient = yield* select((state) => {
        if (tracing.type === "volume") {
          return getVolumeTracingById(state.tracing, tracing.tracingId).version;
        }
        const { skeleton } = state.tracing;
        if (skeleton == null) {
          throw new Error("Skeleton must exist at this point.");
        }
        return skeleton.version;
      });

      const toastKey = `save_conflicts_warning_${tracing.tracingId}`;
      if (versionOnServer > versionOnClient) {
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
            "A newer version of this annotation was found on the server. Your current changes to this annotation cannot be saved anymore.";
        } else {
          msg =
            "A newer version of this annotation was found on the server. Please reload the page to see the newer version. Otherwise, changes to the annotation cannot be saved anymore.";
        }
        Toast.warning(msg, {
          sticky: true,
          key: toastKey,
        });
      } else {
        Toast.close(toastKey);
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

export default [saveTracingAsync, watchForSaveConflicts];
