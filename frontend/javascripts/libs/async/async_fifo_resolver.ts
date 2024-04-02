/*
 * This class can be used to await promises
 * in the order they were passed to
 * orderedWaitFor.
 *
 * This enables scheduling of asynchronous work
 * concurrently while ensuring that the results
 * are processed in the order they were requested
 * (instead of the order in which they finished).
 *
 * Example:
 * const resolver = new AsyncFifoResolver();
 * const promise1Done = resolver.orderedWaitFor(promise1);
 * const promise2Done = resolver.orderedWaitFor(promise2);
 *
 * Even if promise2 resolves before promise1, promise2Done
 * will resolve *after* promise1Done.
 */

export class AsyncFifoResolver<T> {
  queue: Promise<T>[];
  constructor() {
    this.queue = [];
  }

  async orderedWaitFor(promise: Promise<T>): Promise<T> {
    this.queue.push(promise);
    const promiseCountToAwait = this.queue.length;
    const retVals = await Promise.all(this.queue);
    // Note that this.queue can have changed during the await.
    // Find the index of the promise and trim the queue accordingly.
    this.queue = this.queue.slice(this.queue.indexOf(promise) + 1);
    return retVals[promiseCountToAwait - 1];
  }
}
