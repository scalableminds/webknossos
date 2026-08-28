import Deferred from "libs/async/deferred";

/*
 * A simple promise-based mutex class.
 * Usage like this:
 *
 * const mutex = new Mutex();
 * const release = await mutex.acquire();
 * // do stuff...
 * release();
 */
export default class Mutex {
  // The actual mutex is a promise which is either:
  // - resolved if the mutex is NOT acquired
  // - pending if the mutex IS already required (by someone else)
  //   and needs to be awaited.
  // Thus, once the promise is resolved, the mutex is free to use.
  // Multiple acquire calls will construct a promise chain where
  // only the newest promise is stored in innerMutex.
  private innerMutex: Promise<void> = Promise.resolve();

  async acquire(): Promise<() => void> {
    // Remember the current promise in innerMutex which needs
    // to be awaited, so that we know that the mutex is free.
    const prevMutex = this.innerMutex;

    // Create a fresh promise and write it to innerMutex (will
    // be used by the next invocation of acquire).
    const deferred = new Deferred<void, never>();
    this.innerMutex = deferred.promise();

    // Now, wait until the mutex is free by awaiting the old promise.
    await prevMutex;

    // The caller successfully acquired the mutex. The return value is the
    // release function of it.
    return () => deferred.resolve();
  }
}
