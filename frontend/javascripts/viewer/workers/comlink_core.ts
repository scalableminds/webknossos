import {
  expose as ComlinkExpose,
  transfer as ComlinkTransfer,
  transferHandlers as ComlinkTransferHandlers,
  wrap as ComlinkWrap,
} from "comlink";
import {
  requestOptionsTransferHandler,
  throwTransferHandlerWithResponseSupport,
} from "viewer/workers/headers_transfer_handler";

const isNodeContext = typeof process !== "undefined" && process.title !== "browser";

export const wrap = !isNodeContext ? ComlinkWrap : (null as any);
export const transferHandlers = !isNodeContext ? ComlinkTransferHandlers : new Map();
const _expose = !isNodeContext ? ComlinkExpose : null;
const _transfer = !isNodeContext
  ? ComlinkTransfer
  : <P>(element: P, _transferrables: Array<any>): P => element;

if (!isNodeContext) {
  // It's important that transferHandlers are registered in this wrapper module and
  // not from another file. Otherwise, callers would need to register the handler
  // in the main thread as well as in the web worker.
  // Since this wrapper is imported from both sides, the handlers are also registered on both sides.
  transferHandlers.set("requestOptions", requestOptionsTransferHandler);
  // Overwrite the default throw handler with ours that supports responses.
  transferHandlers.set("throw", throwTransferHandlerWithResponseSupport);
}

export type UseCreateWorkerToUseMe<T> = {
  readonly _wrapped: T;
};

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
