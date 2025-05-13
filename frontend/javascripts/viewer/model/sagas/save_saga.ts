import { doWithToken, getNewestVersionForAnnotation } from "admin/rest_api";
import Date from "libs/date";
import ErrorHandling from "libs/error_handling";
import type { RequestOptionsWithData } from "libs/request";
import Request from "libs/request";
import Toast from "libs/toast";
import { sleep } from "libs/utils";
import window, { alert, document, location } from "libs/window";
import _ from "lodash";
import memoizeOne from "memoize-one";
import messages from "messages";
import { call, delay, fork, put, race, take, takeEvery } from "typed-redux-saga";
import { ControlModeEnum } from "viewer/constants";
import { getMagInfo } from "viewer/model/accessors/dataset_accessor";
import { selectTracing } from "viewer/model/accessors/tracing_accessor";
import { FlycamActions } from "viewer/model/actions/flycam_actions";
import {
  pushSaveQueueTransaction,
  setLastSaveTimestampAction,
  setSaveBusyAction,
  setVersionNumberAction,
  shiftSaveQueueAction,
} from "viewer/model/actions/save_actions";
import type { InitializeSkeletonTracingAction } from "viewer/model/actions/skeletontracing_actions";
import { SkeletonTracingSaveRelevantActions } from "viewer/model/actions/skeletontracing_actions";
import { ViewModeSaveRelevantActions } from "viewer/model/actions/view_mode_actions";
import {
  type InitializeVolumeTracingAction,
  VolumeTracingSaveRelevantActions,
} from "viewer/model/actions/volumetracing_actions";
import compactSaveQueue from "viewer/model/helpers/compaction/compact_save_queue";
import compactUpdateActions from "viewer/model/helpers/compaction/compact_update_actions";
import { globalPositionToBucketPosition } from "viewer/model/helpers/position_converter";
import type { Saga } from "viewer/model/sagas/effect-generators";
import { select } from "viewer/model/sagas/effect-generators";
import { ensureWkReady } from "viewer/model/sagas/ready_sagas";
import {
  MAXIMUM_ACTION_COUNT_PER_SAVE,
  MAX_SAVE_RETRY_WAITING_TIME,
  PUSH_THROTTLE_TIME,
  SAVE_RETRY_WAITING_TIME,
} from "viewer/model/sagas/save_saga_constants";
import { diffSkeletonTracing } from "viewer/model/sagas/skeletontracing_saga";
import {
  type UpdateActionWithoutIsolationRequirement,
  updateCameraAnnotation,
  updateTdCamera,
} from "viewer/model/sagas/update_actions";
import { diffVolumeTracing } from "viewer/model/sagas/volumetracing_saga";
import { Model } from "viewer/singletons";
import type {
  CameraData,
  Flycam,
  SaveQueueEntry,
  SkeletonTracing,
  VolumeTracing,
} from "viewer/store";
import { getFlooredPosition, getRotation } from "../accessors/flycam_accessor";
import type { BatchedAnnotationInitializationAction } from "../actions/annotation_actions";
import { takeEveryWithBatchActionSupport } from "./saga_helpers";

const ONE_YEAR_MS = 365 * 24 * 3600 * 1000;

export function* pushSaveQueueAsync(): Saga<never> {
  yield* call(ensureWkReady);

  yield* put(setLastSaveTimestampAction());
  let loopCounter = 0;

  while (true) {
    loopCounter++;
    let saveQueue;
    // Check whether the save queue is actually empty, the PUSH_SAVE_QUEUE_TRANSACTION action
    // could have been triggered during the call to sendSaveRequestToServer
    saveQueue = yield* select((state) => state.save.queue);

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
    yield* put(setSaveBusyAction(true));

    // Send (parts of) the save queue to the server.
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
    //    New items that might be added to the save queue during saving, will be
    //    ignored (they will be picked up in the next iteration of this loop).
    //    Otherwise, the risk of a high number of save-requests (see case 1)
    //    would be present here, too (note the risk would be greater, because the
    //    user didn't use the save button which is usually accompanied by a small pause).
    const itemCountToSave = forcePush
      ? Number.POSITIVE_INFINITY
      : yield* select((state) => state.save.queue.length);
    let savedItemCount = 0;
    while (savedItemCount < itemCountToSave) {
      saveQueue = yield* select((state) => state.save.queue);

      if (saveQueue.length > 0) {
        savedItemCount += yield* call(sendSaveRequestToServer);
      } else {
        break;
      }
    }
    yield* put(setSaveBusyAction(false));
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
function sliceAppropriateBatchCount(batches: Array<SaveQueueEntry>): Array<SaveQueueEntry> {
  const slicedBatches = [];
  let actionCount = 0;

  for (const batch of batches) {
    const newActionCount = actionCount + batch.actions.length;

    if (newActionCount <= MAXIMUM_ACTION_COUNT_PER_SAVE) {
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

export function* sendSaveRequestToServer(): Saga<number> {
  /*
   * Saves a reasonably-sized part of the save queue (that corresponds to the
   * tracingId) to the server (plus retry-mechanism).
   * The saga returns the number of save queue items that were saved.
   */

  const fullSaveQueue = yield* select((state) => state.save.queue);
  const saveQueue = sliceAppropriateBatchCount(fullSaveQueue);
  let compactedSaveQueue = compactSaveQueue(saveQueue);
  const version = yield* select((state) => state.annotation.version);
  const annotationId = yield* select((state) => state.annotation.annotationId);
  const tracingStoreUrl = yield* select((state) => state.annotation.tracingStore.url);
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
        `${tracingStoreUrl}/tracings/annotation/${annotationId}/update?token=`,
        {
          method: "POST",
          data: compactedSaveQueue,
          compress: process.env.NODE_ENV === "production",
          // Suppressing error toast, as the doWithToken retry with personal token functionality should not show an error.
          // Instead the error is logged and toggleErrorHighlighting should take care of showing an error to the user.
          showErrorToast: false,
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

      yield* put(setVersionNumberAction(version + versionIncrement));
      yield* put(setLastSaveTimestampAction());
      yield* put(shiftSaveQueueAction(saveQueue.length));

      try {
        yield* call(markBucketsAsNotDirty, compactedSaveQueue);
      } catch (error) {
        // If markBucketsAsNotDirty fails some reason, wk cannot recover from this error.
        console.warn("Error when marking buckets as clean. No retry possible. Error:", error);
        exceptionDuringMarkBucketsAsNotDirty = true;
        throw error;
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

function* markBucketsAsNotDirty(saveQueue: Array<SaveQueueEntry>) {
  const getLayerAndMagInfoForTracingId = memoizeOne((tracingId: string) => {
    const segmentationLayer = Model.getSegmentationTracingLayer(tracingId);
    const segmentationMagInfo = getMagInfo(segmentationLayer.mags);
    return [segmentationLayer, segmentationMagInfo] as const;
  });
  for (const saveEntry of saveQueue) {
    for (const updateAction of saveEntry.actions) {
      if (updateAction.name === "updateBucket") {
        const { actionTracingId: tracingId } = updateAction.value;
        const [segmentationLayer, segmentationMagInfo] = getLayerAndMagInfoForTracingId(tracingId);

        const { position, mag, additionalCoordinates } = updateAction.value;
        const magIndex = segmentationMagInfo.getIndexByMag(mag);
        const zoomedBucketAddress = globalPositionToBucketPosition(
          position,
          segmentationMagInfo.getDenseMags(),
          magIndex,
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
        getRotation(flycam),
        flycam.zoomStep,
      ),
    );
  }

  if (prevTdCamera !== tdCamera) {
    actions = actions.concat(updateTdCamera());
  }

  return actions;
}

export function* saveTracingAsync(): Saga<void> {
  yield* fork(pushSaveQueueAsync);
  yield* takeEvery("INITIALIZE_ANNOTATION_WITH_TRACINGS", setupSavingForAnnotation);
  yield* takeEveryWithBatchActionSupport("INITIALIZE_SKELETONTRACING", setupSavingForTracingType);
  yield* takeEveryWithBatchActionSupport("INITIALIZE_VOLUMETRACING", setupSavingForTracingType);
}

function* setupSavingForAnnotation(_action: BatchedAnnotationInitializationAction): Saga<void> {
  // todop: wouldn't it make more sense to read the prev* vars after ensureWkReady? probably changes tests
  let prevFlycam = yield* select((state) => state.flycam);
  let prevTdCamera = yield* select((state) => state.viewModeData.plane.tdCamera);
  yield* call(ensureWkReady);

  while (true) {
    yield* take([
      ...FlycamActions,
      ...ViewModeSaveRelevantActions,
      ...SkeletonTracingSaveRelevantActions,
    ]);
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
  const saveQueueType =
    initializeAction.type === "INITIALIZE_SKELETONTRACING" ? "skeleton" : "volume";
  const tracingId = initializeAction.tracing.id;
  let prevTracing = (yield* select((state) => selectTracing(state, saveQueueType, tracingId))) as
    | VolumeTracing
    | SkeletonTracing;

  yield* call(ensureWkReady);

  while (true) {
    if (saveQueueType === "skeleton") {
      yield* take([...SkeletonTracingSaveRelevantActions, "SET_SKELETON_TRACING"]);
    } else {
      yield* take(VolumeTracingSaveRelevantActions);
    }

    // The allowUpdate setting could have changed in the meantime
    const allowUpdate = yield* select(
      (state) =>
        state.annotation.restrictions.allowUpdate && state.annotation.restrictions.allowSave,
    );
    if (!allowUpdate) continue;
    const tracing = (yield* select((state) => selectTracing(state, saveQueueType, tracingId))) as
      | VolumeTracing
      | SkeletonTracing;

    const items = compactUpdateActions(
      Array.from(yield* call(performDiffTracing, prevTracing, tracing)),
      tracing,
    );

    if (items.length > 0) {
      yield* put(pushSaveQueueTransaction(items));
    }

    prevTracing = tracing;
  }
}

const VERSION_POLL_INTERVAL_COLLAB = 10 * 1000;
const VERSION_POLL_INTERVAL_READ_ONLY = 60 * 1000;
const VERSION_POLL_INTERVAL_SINGLE_EDITOR = 30 * 1000;

function* watchForSaveConflicts(): Saga<never> {
  function* checkForNewVersion() {
    const allowSave = yield* select(
      (state) =>
        state.annotation.restrictions.allowSave && state.annotation.restrictions.allowUpdate,
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

    const maybeSkeletonTracing = yield* select((state) => state.annotation.skeleton);
    const volumeTracings = yield* select((state) => state.annotation.volumes);
    const tracingStoreUrl = yield* select((state) => state.annotation.tracingStore.url);
    const annotationId = yield* select((state) => state.annotation.annotationId);

    const tracings: Array<SkeletonTracing | VolumeTracing> = _.compact([
      ...volumeTracings,
      maybeSkeletonTracing,
    ]);

    if (tracings.length === 0) {
      return;
    }

    const versionOnServer = yield* call(
      getNewestVersionForAnnotation,
      tracingStoreUrl,
      annotationId,
    );

    // Read the tracing version again from the store, since the
    // old reference to tracing might be outdated now due to the
    // immutability.
    const versionOnClient = yield* select((state) => {
      return state.annotation.version;
    });

    const toastKey = "save_conflicts_warning";
    if (versionOnServer > versionOnClient) {
      // The latest version on the server is greater than the most-recently
      // stored version.

      const saveQueue = yield* select((state) => state.save.queue);

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

  function* getPollInterval(): Saga<number> {
    const allowSave = yield* select((state) => state.annotation.restrictions.allowSave);
    if (!allowSave) {
      // The current user may not edit/save the annotation.
      return VERSION_POLL_INTERVAL_READ_ONLY;
    }

    const othersMayEdit = yield* select((state) => state.annotation.othersMayEdit);
    if (othersMayEdit) {
      // Other users may edit the annotation.
      return VERSION_POLL_INTERVAL_COLLAB;
    }

    // The current user is the only one who can edit the annotation.
    return VERSION_POLL_INTERVAL_SINGLE_EDITOR;
  }

  yield* call(ensureWkReady);

  while (true) {
    const interval = yield* call(getPollInterval);
    yield* call(sleep, interval);
    if (yield* select((state) => state.uiInformation.showVersionRestore)) {
      continue;
    }
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
