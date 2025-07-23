// /*
//  * This module contains the sagas responsible for sending the contents of the save queue
//  * to the back-end (thus, draining the queue).
//  */

import { sendSaveRequestWithToken } from "admin/rest_api";
import Date from "libs/date";
import ErrorHandling from "libs/error_handling";
import Toast from "libs/toast";
import window, { alert, document, location } from "libs/window";
import memoizeOne from "memoize-one";
import messages from "messages";
import { call, delay, put, race, take } from "typed-redux-saga";
import { ControlModeEnum } from "viewer/constants";
import { getMagInfo } from "viewer/model/accessors/dataset_accessor";
import {
  dispatchEnsureHasNewestVersionAsync,
  dispatchEnsureMaySaveNowAsync,
  doneSavingAction,
  setLastSaveTimestampAction,
  setSaveBusyAction,
  setVersionNumberAction,
  shiftSaveQueueAction,
} from "viewer/model/actions/save_actions";
import compactSaveQueue from "viewer/model/helpers/compaction/compact_save_queue";
import { globalPositionToBucketPosition } from "viewer/model/helpers/position_converter";
import type { Saga } from "viewer/model/sagas/effect-generators";
import { select } from "viewer/model/sagas/effect-generators";
import { ensureWkReady } from "viewer/model/sagas/ready_sagas";
import {
  MAXIMUM_ACTION_COUNT_PER_SAVE,
  MAX_SAVE_RETRY_WAITING_TIME,
  PUSH_THROTTLE_TIME,
  SAVE_RETRY_WAITING_TIME,
} from "viewer/model/sagas/saving/save_saga_constants";
import { Model, Store } from "viewer/singletons";
import type { SaveQueueEntry } from "viewer/store";

export function* pushSaveQueueAsync(): Saga<never> {
  /*
   * This saga continuously drains the save queue by sending its content to the server.
   */
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

    // Wait until we may save (due to mutex aquisition).
    debugger;
    yield* call(dispatchEnsureMaySaveNowAsync, Store.dispatch);
    // Wait until we have the newest version. This *must* happen after
    // dispatchEnsureMaySaveNowAsync, because otherwise there would be a
    // race condition where the frontend thinks that it knows about the newest
    // version when in fact somebody else saved a newer version in the meantime.
    debugger;
    yield* call(dispatchEnsureHasNewestVersionAsync, Store.dispatch);

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
    console.log("itemCountToSave", itemCountToSave);
    let savedItemCount = 0;
    while (savedItemCount < itemCountToSave) {
      saveQueue = yield* select((state) => state.save.queue);

      if (saveQueue.length > 0) {
        savedItemCount += yield* call(sendSaveRequestToServer);
      } else {
        break;
      }
    }
    yield* put(doneSavingAction());
    yield* put(setSaveBusyAction(false));
  }
}

function getRetryWaitTime(retryCount: number) {
  // Exponential backoff up until MAX_SAVE_RETRY_WAITING_TIME
  return Math.min(2 ** retryCount * SAVE_RETRY_WAITING_TIME, MAX_SAVE_RETRY_WAITING_TIME);
}

export function* sendSaveRequestToServer(): Saga<number> {
  /*
   * Saves a reasonably-sized part of the save queue to the server (plus retry-mechanism).
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
        sendSaveRequestWithToken,
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

        yield* call(alert, messages["save.failed_simultaneous_tracing"]);
        location.reload();

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
