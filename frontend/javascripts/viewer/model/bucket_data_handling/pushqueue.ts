import { AsyncFifoResolver } from "libs/async/async_fifo_resolver";
import { createDebouncedAbortableParameterlessCallable } from "libs/async/debounced_abortable_saga";
import { call } from "redux-saga/effects";
import type { DataBucket } from "viewer/model/bucket_data_handling/bucket";
import type DataCube from "viewer/model/bucket_data_handling/data_cube";
import { createCompressedUpdateBucketActions } from "viewer/model/bucket_data_handling/wkstore_adapter";
import Store from "viewer/store";
import { escalateErrorAction } from "../actions/actions";
import { pushSaveQueueTransaction } from "../actions/save_actions";
import type { UpdateActionWithoutIsolationRequirement } from "../sagas/update_actions";

// Only process the PushQueue after there was no user interaction (or bucket modification due to
// downsampling) for PUSH_DEBOUNCE_TIME milliseconds.
// PushQueue.getTransactionWaitTime is used to avoid debounce-related starvation that can happen
// when the user constantly annotates.
const PUSH_DEBOUNCE_TIME = 1000;

class PushQueue {
  cube: DataCube;
  tracingId: string;

  // The pendingBuckets contains all buckets that should be:
  // - snapshotted,
  // - put into one transaction and then
  // - saved
  // That set is flushed in a debounced manner so that the time of the
  // snapshot should be suitable for a transaction (since neither WK nor the
  // user edited the buckets in a certain time window).
  private pendingBuckets: Set<DataBucket>;

  // Every time the pendingBuckets is flushed, its content is put into a transaction.
  // That transaction is compressed asynchronously before it is sent to the store.
  // Buckets that are currently being compressed, are counted in this property.
  private compressingBucketCount: number = 0;

  // Helper to ensure the Store's save queue is filled in the correct
  // order.
  private fifoResolver = new AsyncFifoResolver<UpdateActionWithoutIsolationRequirement[]>();

  // If the timestamp is defined, it encodes when the first bucket
  // was added to the PushQueue that will be part of the next (to be created)
  // transaction.
  private waitTimeStartTimeStamp: number | null = null;

  constructor(cube: DataCube, tracingId: string) {
    this.cube = cube;
    this.tracingId = tracingId;
    this.pendingBuckets = new Set();
  }

  stateSaved(): boolean {
    return (
      this.pendingBuckets.size === 0 &&
      this.cube.temporalBucketManager.getCount() === 0 &&
      this.compressingBucketCount === 0
    );
  }

  insert(bucket: DataBucket): void {
    if (this.waitTimeStartTimeStamp == null) {
      this.waitTimeStartTimeStamp = Date.now();
    }
    if (!this.pendingBuckets.has(bucket)) {
      this.pendingBuckets.add(bucket);
      bucket.dirtyCount++;
    }
    this.push();
  }

  getPendingBucketCount(): number {
    return this.pendingBuckets.size;
  }

  getCompressingBucketCount(): number {
    return this.compressingBucketCount;
  }

  getTransactionWaitTime(): number {
    // Return how long we are waiting for the transaction flush
    // (waiting time depends on the user activity and on the
    // time it takes to download buckets).
    if (this.waitTimeStartTimeStamp == null) {
      // No pending buckets exist. There's no wait time.
      return 0;
    }

    return Date.now() - this.waitTimeStartTimeStamp;
  }

  clear(): void {
    this.pendingBuckets.clear();
  }

  print(): void {
    this.pendingBuckets.forEach((e) => console.log(e));
  }

  pushImpl = function* (this: PushQueue) {
    try {
      // Wait until there are no temporal buckets, anymore, so that
      // all buckets can be snapshotted and saved to the server.
      // If PushQueue.push() is called while we are waiting here,
      // this generator is aborted and the debounce-time begins
      // again.
      yield call(this.cube.temporalBucketManager.getAllLoadedPromise);

      // It is important that flushAndSnapshot does not use a generator
      // mechanism, because it could get cancelled due to
      // createDebouncedAbortableParameterlessCallable otherwise.
      this.flushAndSnapshot();
    } catch (error) {
      // The above code is critical for saving volume data. Because the
      // code is invoked asynchronously, there won't be a default error
      // handling in case it crashes due to a bug.
      // Therefore, escalate the error manually so that the sagas will crash
      // (notifying the user and stopping further potentially undefined behavior).
      Store.dispatch(escalateErrorAction(error));
    }
  };

  private flushAndSnapshot() {
    this.waitTimeStartTimeStamp = null;
    // Flush pendingBuckets. Note that it's important to do this synchronously.
    // Otherwise, other actors might add to pendingBuckets concurrently during the flush,
    // causing an inconsistent state for a transaction.
    const batch: DataBucket[] = Array.from(this.pendingBuckets);
    this.pendingBuckets = new Set();

    // Fire and forget. The correct transaction ordering is ensured
    // within pushTransaction.
    this.pushTransaction(batch);
  }

  push = createDebouncedAbortableParameterlessCallable(this.pushImpl, PUSH_DEBOUNCE_TIME, this);

  private async pushTransaction(batch: Array<DataBucket>): Promise<void> {
    /*
     * Create a transaction from the batch and push it into the save queue.
     */
    try {
      this.compressingBucketCount += batch.length;

      // Start the compression job. Note that an older invocation of
      // createCompressedUpdateBucketActions might still be running.
      // We can still *start* a new compression job, but we want to ensure
      // that the jobs are processed in the order they were initiated.
      // This is done using orderedWaitFor.
      // Addendum:
      // In practice, this won't matter much since compression jobs
      // are processed by a pool of webworkers in fifo-order, anyway.
      // However, there is a theoretical chance of a race condition,
      // since the fifo-ordering is only ensured for starting the webworker
      // and not for receiving the return values.
      const items = await this.fifoResolver.orderedWaitFor(
        createCompressedUpdateBucketActions(batch),
      );
      Store.dispatch(pushSaveQueueTransaction(items));

      this.compressingBucketCount -= batch.length;
    } catch (error) {
      // See other usage of escalateErrorAction for a detailed explanation.
      Store.dispatch(escalateErrorAction(error));
    }
  }
}

export default PushQueue;
