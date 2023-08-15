import _ from "lodash";
import type { DataBucket } from "oxalis/model/bucket_data_handling/bucket";
import { alert } from "libs/window";
import { createCompressedUpdateBucketActions } from "oxalis/model/bucket_data_handling/wkstore_adapter";
import type DataCube from "oxalis/model/bucket_data_handling/data_cube";
import { createDebouncedAbortableParameterlessCallable } from "libs/debounced_abortable_saga";
import { call } from "redux-saga/effects";
import { Store } from "oxalis/singletons";
import { pushSaveQueueTransaction } from "../actions/save_actions";
import { UpdateAction } from "../sagas/update_actions";
import { AsyncFifoResolver } from "libs/async_fifo_resolver";

export const COMPRESSING_BATCH_SIZE = 32;
// Only process the PushQueue after there was no user interaction (or bucket modification due to
// downsampling) for PUSH_DEBOUNCE_TIME milliseconds...
const PUSH_DEBOUNCE_TIME = 1000;
// ...unless a timeout of PUSH_DEBOUNCE_MAX_WAIT_TIME milliseconds
// is exceeded. Then, initiate a push.
// todo: reactivate?
const _PUSH_DEBOUNCE_MAX_WAIT_TIME = 30000;

class PushQueue {
  cube: DataCube;

  private fifoResolver = new AsyncFifoResolver<UpdateAction[]>();

  // The pendingQueue contains all buckets that should be:
  // - snapshotted,
  // - put into one transaction and then
  // - saved
  // That queue is flushed in a debounced manner so that the time of the
  // snapshot should be suitable for a transaction (since neither WK nor the
  // user edited the buckets in a certain time window).
  private pendingQueue: Set<DataBucket>;

  // Everytime the pendingQueue is flushed, its content is put into a transaction.
  // That transaction is compressed asynchronously before it is sent to the store.
  // During that compression, the transaction is counted as pending.
  private pendingTransactionCount: number = 0;

  constructor(cube: DataCube) {
    this.cube = cube;
    this.pendingQueue = new Set();
  }

  stateSaved(): boolean {
    return (
      this.pendingQueue.size === 0 &&
      this.cube.temporalBucketManager.getCount() === 0 &&
      this.pendingTransactionCount === 0
    );
  }

  insert(bucket: DataBucket): void {
    if (!this.pendingQueue.has(bucket)) {
      this.pendingQueue.add(bucket);
      bucket.dirtyCount++;
    }
    this.push();
  }

  clear(): void {
    this.pendingQueue.clear();
  }

  print(): void {
    this.pendingQueue.forEach((e) => console.log(e));
  }

  pushImpl = function* (this: PushQueue) {
    try {
      console.log("pushImpl start");
      // Wait until there are no temporal buckets, anymore, so that
      // all buckets can be snapshotted and saved to the server.
      yield call(this.cube.temporalBucketManager.getAllLoadedPromise);

      // It is important that flushAndSnapshot does not use a generator
      // mechanism, because it could get cancelled due to
      // createDebouncedAbortableParameterlessCallable otherwise.
      this.flushAndSnapshot();
    } catch (_error) {
      // Error Recovery!
      // todo: somewhere else?
      alert("We've encountered a permanent issue while saving. Please try to reload the page.");
    }
    console.log("pushImpl end");
  };

  private flushAndSnapshot() {
    // Flush pendingQueue. Note that it's important to do this synchronously.
    // If other actors could add to queue concurrently, the front-end could
    // send an inconsistent state for a transaction.
    console.log("Flush pending queue with size:", this.pendingQueue.size);
    const batch: DataBucket[] = Array.from(this.pendingQueue);
    this.pendingQueue = new Set();

    // Fire and forget. The correct transaction ordering is ensured
    // within pushTransaction.
    this.pushTransaction(batch);
  }

  // todo: prevent user from brushing for eternity?
  // push = _.debounce(this.pushImpl, PUSH_DEBOUNCE_TIME, {
  //   maxWait: PUSH_DEBOUNCE_MAX_WAIT_TIME,
  // });

  push = createDebouncedAbortableParameterlessCallable(this.pushImpl, PUSH_DEBOUNCE_TIME, this);

  async pushTransaction(batch: Array<DataBucket>): Promise<void> {
    /*
     * Create a transaction from the batch and push it into the save queue.
     */
    this.pendingTransactionCount++;

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
    Store.dispatch(pushSaveQueueTransaction(items, "volume", this.cube.layerName));

    this.pendingTransactionCount--;
  }
}

export default PushQueue;
