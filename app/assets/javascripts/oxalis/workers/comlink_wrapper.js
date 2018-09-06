import headersTransferHandler from "oxalis/workers/headers_transfer_handler";

const isNodeContext = typeof process !== "undefined" && process.title !== "browser";

function importComlink() {
  if (!isNodeContext) {
    // eslint-disable-next-line global-require
    const { proxy, transferHandlers, expose: _expose } = require("comlinkjs");
    return { proxy, transferHandlers, _expose };
  } else {
    return {
      proxy: null,
      transferHandlers: new Map(),
      _expose: null,
    };
  }
}

const { proxy, transferHandlers, _expose } = importComlink();

// It's important that transferHandlers are registered in this wrapper module and
// not from another file. Otherwise, callers would need to register the handler
// in the main thread as well as in the web worker.
// Since this wrapper is imported from both sides, the handlers are also registered on both sides.
transferHandlers.set("Headers", headersTransferHandler);

export const createWorker: <Fn>(fn: Fn) => Fn = WorkerClass => {
  if (isNodeContext) {
    // In a node context (e.g., when executing tests), we don't create web workers
    return WorkerClass;
  }

  return proxy(
    // When importing a worker module, flow doesn't know that a special Worker class
    // is imported. Instead, flow thinks that the declared function is
    // directly imported. We exploit this by simply typing this createWorker function as an identity function
    // (T => T). That way, we gain proper flow typing for functions executed in web workers. However,
    // we need to suppress the following flow error for that to work.
    // $FlowFixMe
    new WorkerClass(),
  );
};

export const expose = <T>(fn: T): T => {
  // In a node context (e.g., when executing tests), we don't create web workers
  if (!isNodeContext) {
    _expose(fn, self);
  }
  return fn;
};
