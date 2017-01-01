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

    this._resolve = null;
    this._reject = null;
    this._promise = new Promise((resolve, reject) => {
      this._resolve = resolve;
      return this._reject = reject;
    }
    );
  }


  resolve(arg) {

    return this._resolve(arg);
  }


  reject(arg) {

    return this._reject(arg);
  }


  promise() {

    return this._promise;
  }
}


export default Deferred;
