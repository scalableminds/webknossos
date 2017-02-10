/*
 * deferred.js
 * @flow
 */

class Deferred<T, U> {
  internalResolve: (T) => void;
  internalReject: (U) => void;
  internalPromise: Promise<T>;

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
    this.internalPromise = new Promise((resolve, reject) => {
      this.internalResolve = resolve;
      this.internalReject = reject;
    });
  }


  resolve(arg: T): void {
    this.internalResolve(arg);
  }


  reject(arg: U): void {
    this.internalReject(arg);
  }


  promise(): Promise<T> {
    return this.internalPromise;
  }
}


export default Deferred;
