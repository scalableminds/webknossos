/*
 * deferred.js
 * @flow
 */

class Deferred<T, U> {
  _internalResolve: (T) => void;
  _internalReject: (U) => void;
  _internalPromise: Promise<T>;

  // Wrapper around `Promise` that keeps a reference to `resolve` and `reject`
  // methods.
  //
  // Sample Usage:
  // ```
  // d = new Deferred()
  // setTimeout(
  //   -> d.internalResolve()
  //   1000
  // )
  // return d.internalPromise()
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
