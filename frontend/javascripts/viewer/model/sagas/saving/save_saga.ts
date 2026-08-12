import { fork, takeEvery } from "typed-redux-saga";
import type { Saga } from "viewer/model/sagas/effect_generators";
import { takeEveryWithBatchActionSupport } from "../saga_helpers";
import { watchForNumberOfBucketsInSaveQueue } from "./bucket_save_warning_saga";
import { pushSaveQueueAsync } from "./save_queue_draining_saga";
import { setupSavingForAnnotation, setupSavingForTracingType } from "./save_queue_filling_saga";
import { watchForNewerAnnotationVersion } from "./version_poll_saga";

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
