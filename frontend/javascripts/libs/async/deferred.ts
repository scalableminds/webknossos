class Deferred<T, U> {
  // @ts-expect-error ts-migrate(2564) FIXME: Property '_internalResolve' has no initializer and... Remove this comment to see the full error message
  _internalResolve: (arg0: T) => void;
  // @ts-expect-error ts-migrate(2564) FIXME: Property '_internalReject' has no initializer and ... Remove this comment to see the full error message
  _internalReject: (arg0: U) => void;
  _internalPromise: Promise<T>;

  // Wrapper around `Promise` that keeps a reference to `resolve` and `reject`
  // methods.
  //
  // Sample Usage:
  // ```
  // d = new Deferred()
  // setTimeout(
  //   () => d.resolve(),
  //   1000
  // )
  // d.promise().then(...)
  // ```
  constructor() {
    this._internalPromise = new Promise((resolve, reject) => {
      this._internalResolve = resolve;
      this._internalReject = reject;
    });
  }

  resolve(arg: T): void {
    this._internalResolve(arg);
  }

  reject(arg: U): void {
    this._internalReject(arg);
  }

  promise(): Promise<T> {
    return this._internalPromise;
  }

  task(): () => Promise<T> {
    return () => this.promise();
  }
}

export default Deferred;
