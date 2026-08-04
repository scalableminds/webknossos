import { fork, takeEvery } from "typed-redux-saga";
import type { Saga } from "viewer/model/sagas/effect_generators";
import { takeEveryWithBatchActionSupport } from "../saga_helpers";
import { watchForNumberOfBucketsInSaveQueue } from "./bucket_save_warning_saga";
import { pushSaveQueueAsync } from "./save_queue_draining_saga";
import { setupSavingForAnnotation, setupSavingForTracingType } from "./save_queue_filling_saga";
import { watchForNewerAnnotationVersion } from "./version_poll_saga";

/*
 * This module is the entry point of the saving-related sagas. The actual work is done in the
 * sibling modules:
 * - save_queue_filling_saga: diffs the local state into update actions and fills the save queue
 * - save_queue_draining_saga: sends the save queue's content to the server
 * - version_poll_saga: polls the server for newer versions and triggers rebases (rebasing_sagas)
 * - bucket_save_warning_saga: warns about very many bucket updates in the save queue
 */

function* setupSavingToServer(): Saga<void> {
  // This saga continuously drains the save queue by sending its content to the server.
  yield* fork(pushSaveQueueAsync);
  // The following sagas are responsible for filling the save queue with the update actions.
  yield* takeEvery("INITIALIZE_ANNOTATION_WITH_TRACINGS", setupSavingForAnnotation);
  yield* takeEveryWithBatchActionSupport("INITIALIZE_SKELETONTRACING", setupSavingForTracingType);
  yield* takeEveryWithBatchActionSupport("INITIALIZE_VOLUMETRACING", setupSavingForTracingType);
  yield* takeEvery("WK_READY", watchForNumberOfBucketsInSaveQueue);
}

export default [setupSavingToServer, watchForNewerAnnotationVersion];
