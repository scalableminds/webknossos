class Deferred {
  // Wrapper around `Promise` that keeps a reference to `resolve` and `reject`
  // methods.
  //
  // Sample Usage:
  // ```
  // d = new Deferred()
  // setTimeout(
  //   -> d.resolve()
  //   1000
  // )
  // return d.promise()
  // ```


  constructor() {
    this.resolve = null;
    this.reject = null;
    this.promise = new Promise((resolve, reject) => {
      this.resolve = resolve;
      return this.reject = reject;
    },
    );
  }


  resolve(arg) {
    return this.resolve(arg);
  }


  reject(arg) {
    return this.reject(arg);
  }


  promise() {
    return this.promise;
  }
}


export default Deferred;
