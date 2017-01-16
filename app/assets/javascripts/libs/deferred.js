class Deferred {
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
    this.internalResolve = null;
    this.internalReject = null;
    this.internalPromise = new Promise((resolve, reject) => {
      this.internalResolve = resolve;
      this.internalReject = reject;
    });
  }


  resolve(arg) {
    return this.internalResolve(arg);
  }


  reject(arg) {
    return this.internalReject(arg);
  }


  promise() {
    return this.internalPromise;
  }
}


export default Deferred;
