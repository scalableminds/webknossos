import features from "features";
import sum from "lodash-es/sum";
import { delay, takeEvery } from "typed-redux-saga";
import { showManyBucketUpdatesWarningAction } from "viewer/model/actions/annotation_actions";
import type { NotifyAboutUpdatedBucketsAction } from "viewer/model/actions/save_actions";
import type { Saga } from "viewer/model/sagas/effect_generators";
import { Store } from "viewer/singletons";

/*
 * This module warns the user in case a lot of bucket data is queued for saving within a short
 * period of time (which usually hints at an unintended, very large volume annotation operation).
 */

// interval at which the number of buckets in save queue is checked
const CHECK_NUMBER_OF_BUCKETS_IN_SAVE_QUEUE_INTERVAL_MS = 10 * 1000;
// sliding time window for which the number of buckets in save queue is summed up
const CHECK_NUMBER_OF_BUCKETS_SLIDING_WINDOW_MS = 120 * 1000;

export function* watchForNumberOfBucketsInSaveQueue(): Saga<void> {
  const bucketSaveWarningThreshold = features().bucketSaveWarningThreshold;
  let bucketsForCurrentInterval = 0;
  let currentBucketCounts: Array<number> = [];
  const bucketCountArrayLength = Math.floor(
    CHECK_NUMBER_OF_BUCKETS_SLIDING_WINDOW_MS / CHECK_NUMBER_OF_BUCKETS_IN_SAVE_QUEUE_INTERVAL_MS,
  );
  yield* takeEvery("NOTIFY_ABOUT_UPDATED_BUCKETS", (action: NotifyAboutUpdatedBucketsAction) => {
    bucketsForCurrentInterval += action.count;
  });
  while (true) {
    yield* delay(CHECK_NUMBER_OF_BUCKETS_IN_SAVE_QUEUE_INTERVAL_MS);
    const sumOfBuckets = sum(currentBucketCounts);
    if (sumOfBuckets > bucketSaveWarningThreshold) {
      Store.dispatch(showManyBucketUpdatesWarningAction());
    }
    currentBucketCounts.push(bucketsForCurrentInterval);
    if (currentBucketCounts.length > bucketCountArrayLength) {
      currentBucketCounts.shift();
    }
    bucketsForCurrentInterval = 0;
  }
}
