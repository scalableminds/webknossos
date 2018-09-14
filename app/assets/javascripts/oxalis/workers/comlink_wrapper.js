// @flow
import headersTransferHandler from "oxalis/workers/headers_transfer_handler";

function importComlink() {
  const isNodeContext = typeof process !== "undefined" && process.title !== "browser";
  if (!isNodeContext) {
    // Comlink should only be imported in a browser context, since it makes use of functionality
    // which does not exist in node
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

// Worker modules export bare functions, but webpack turns these into Worker classes which need to be
// instantiated first.
// To ensure that code always executes the necessary instantiation, we cheat a bit with the typing in the following code.
// In reality, `expose` receives a function and returns it again. However, we tell flow that it wraps the function, so that
// unwrapping becomes necessary.
// The unwrapping has to be done with `createWorker` which in fact instantiates the worker class.
// As a result, we have some cheated types in the following two functions, but gain type safety for all usages of web worker modules.
type UseCreateWorkerToUseMe<T> = { +_wrapped: T };

export function createWorker<T>(WorkerClass: UseCreateWorkerToUseMe<T>): T {
  if (proxy == null) {
    // In a node context (e.g., when executing tests), we don't create web workers which is why
    // we can simply return the input function here.
    // $FlowIgnore
    return WorkerClass;
  }

  return proxy(
    // When importing a worker module, flow doesn't know that a special Worker class
    // is imported. Instead, flow thinks that the declared function is
    // directly imported. We exploit this by simply typing this createWorker function as an identity function
    // (T => T). That way, we gain proper flow typing for functions executed in web workers. However,
    // we need to suppress the following flow error for that to work.
    // $FlowIgnore
    new WorkerClass(),
  );
}

export function expose<T>(fn: T): UseCreateWorkerToUseMe<T> {
  // In a node context (e.g., when executing tests), we don't create web workers
  if (_expose != null) {
    _expose(fn, self);
  }
  // $FlowIgnore
  return fn;
}
