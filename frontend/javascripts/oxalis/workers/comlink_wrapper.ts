import {
  requestOptionsTransferHandler,
  throwTransferHandlerWithResponseSupport,
} from "oxalis/workers/headers_transfer_handler";

function importComlink() {
  const isNodeContext = typeof process !== "undefined" && process.title !== "browser";

  if (!isNodeContext) {
    // Comlink should only be imported in a browser context, since it makes use of functionality
    // which does not exist in node

    const { wrap, transferHandlers, expose: _expose, transfer: _transfer } = require("comlink");

    return {
      wrap,
      transferHandlers,
      _expose,
      _transfer,
    };
  } else {
    return {
      wrap: null,
      transferHandlers: new Map(),
      _expose: null,
      _transfer: <P>(element: P, _transferrables: Array<any>): P => element,
    };
  }
}

const { wrap, transferHandlers, _expose, _transfer } = importComlink();
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
type UseCreateWorkerToUseMe<T> = {
  readonly _wrapped: T;
};
export function createWorker<T extends (...args: any) => any>(
  WorkerClass: UseCreateWorkerToUseMe<T>,
): (...params: Parameters<T>) => Promise<ReturnType<T>> {
  if (wrap == null) {
    // In a node context (e.g., when executing tests), we don't create web workers which is why
    // we can simply return the input function here.
    // @ts-ignore
    return WorkerClass;
  }

  return wrap(
    // @ts-ignore
    new WorkerClass(),
  );
}
export function expose<T>(fn: T): UseCreateWorkerToUseMe<T> {
  if (_expose != null) {
    _expose(fn, self);
  }

  // In a node context (e.g., when executing tests), we don't create web workers.
  // Therefore, we simply return the passed function with the only change that
  // we are wrapping the return value in a promise. That way, the worker and non-worker
  // versions both return promises.
  // @ts-ignore
  return fn;
}

export const transfer = _transfer;
