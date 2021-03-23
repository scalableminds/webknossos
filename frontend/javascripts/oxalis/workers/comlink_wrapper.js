// @flow
import {
  requestOptionsTransferHandler,
  throwTransferHandlerWithResponseSupport,
} from "oxalis/workers/headers_transfer_handler";

function importComlink() {
  const isNodeContext = typeof process !== "undefined" && process.title !== "browser";
  if (!isNodeContext) {
    // Comlink should only be imported in a browser context, since it makes use of functionality
    // which does not exist in node
    // eslint-disable-next-line global-require
    const { wrap, transferHandlers, expose: _expose } = require("comlink");
    return { wrap, transferHandlers, _expose };
  } else {
    return {
      wrap: null,
      transferHandlers: new Map(),
      _expose: null,
    };
  }
}

const { wrap, transferHandlers, _expose } = importComlink();

// It's important that transferHandlers are registered in this wrapper module and
// not from another file. Otherwise, callers would need to register the handler
// in the main thread as well as in the web worker.
// Since this wrapper is imported from both sides, the handlers are also registered on both sides.
transferHandlers.set("requestOptions", requestOptionsTransferHandler);
// Overwrite the default throw handler with ours that supports responses.
transferHandlers.set("throw", throwTransferHandlerWithResponseSupport);

// Worker modules export bare functions, but webpack turns these into Worker classes which need to be
// instantiated first.
// To ensure that code always executes the necessary instantiation, we cheat a bit with the typing in the following code.
// In reality, `expose` receives a function and returns it again. However, we tell flow that it wraps the function, so that
// unwrapping becomes necessary.
// The unwrapping has to be done with `createWorker` which in fact instantiates the worker class.
// As a result, we have some cheated types in the following two functions, but gain type safety for all usages of web worker modules.
type UseCreateWorkerToUseMe<T> = { +_wrapped: T };

export function createWorker<T>(WorkerClass: UseCreateWorkerToUseMe<T>): T {
  if (wrap == null) {
    // In a node context (e.g., when executing tests), we don't create web workers which is why
    // we can simply return the input function here.
    // $FlowExpectedError[incompatible-return]
    return WorkerClass;
  }

  return wrap(
    // $FlowExpectedError[not-a-function]
    new WorkerClass(),
  );
}

export function expose<T>(fn: T): UseCreateWorkerToUseMe<T> {
  // In a node context (e.g., when executing tests), we don't create web workers
  if (_expose != null) {
    _expose(fn, self);
  }
  // $FlowExpectedError[incompatible-return]
  return fn;
}

export function pretendPromise<T>(t: T): Promise<T> {
  // The top level function within a webworker doesn't necessarily
  // need to return a promise. However, when called from the main thread
  // we will always get a promise. Since flow isn't able to express this
  // for variadic function types, we have to cheat with the return type on
  // the call side. For this scenario, this function can be used (see
  // async_bucket_picker.worker.js as an example).
  // $FlowExpectedError[incompatible-return]
  return t;
}
