import {
  requestOptionsTransferHandler,
  throwTransferHandlerWithResponseSupport,
} from "viewer/workers/headers_transfer_handler";

async function importComlink() {
  const isNodeContext = typeof process !== "undefined" && process.title !== "browser";

  if (!isNodeContext) {
    // Comlink should only be imported in a browser context, since it makes use of functionality
    // which does not exist in node
    const {
      wrap,
      transferHandlers,
      expose: _expose,
      transfer: _transfer,
    } = await import("comlink");

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

const { wrap, transferHandlers, _expose, _transfer } = await importComlink();
// It's important that transferHandlers are registered in this wrapper module and
// not from another file. Otherwise, callers would need to register the handler
// in the main thread as well as in the web worker.
// Since this wrapper is imported from both sides, the handlers are also registered on both sides.
transferHandlers.set("requestOptions", requestOptionsTransferHandler);
// Overwrite the default throw handler with ours that supports responses.
transferHandlers.set("throw", throwTransferHandlerWithResponseSupport);
// Worker modules export bare functions. In the browser (Vite), we use the web workers
// to instantiate them. In Node (Vitest), we dynamically import the worker module
// and execute the function directly.
// To gain type safety for all usages of web worker modules, we cheat a bit with the typing.
// In reality, `expose` receives a function and returns it again. However, we tell TypeScript
// that it wraps the function, so that unwrapping becomes necessary.
// The unwrapping is done with `createWorker` which either instantiates the web worker module
// or returns the dynamically imported function.
type UseCreateWorkerToUseMe<T> = {
  readonly _wrapped: T;
};

export function createWorker<T extends (...args: any[]) => any>(
  pathToWorker: string,
): (...params: Parameters<T>) => Promise<ReturnType<T>> {
  if (wrap == null) {
    // In a node context (e.g., when executing tests), we don't create web workers.
    // Instead, we dynamically import the worker and return its default export.
    return (async (...params: Parameters<T>) => {
      const workerModule = await import(`./${pathToWorker}`);
      return workerModule.default(...params);
    }) as any;
  }

  // this URL is relative to <root>/frontend/javascripts/viewer/workers
  const url = new URL(pathToWorker, import.meta.url);
  // @ts-expect-error
  return wrap(new Worker(url, { type: "module" }));
}
export function expose<T>(fn: T): UseCreateWorkerToUseMe<T> {
  if (_expose != null) {
    _expose(fn);
  }

  // In a node context (e.g., when executing tests), we don't create web workers.
  // Therefore, we simply return the passed function.
  // @ts-expect-error
  return fn;
}

export const transfer = _transfer;
