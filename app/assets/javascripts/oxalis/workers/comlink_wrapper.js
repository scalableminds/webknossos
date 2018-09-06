import {
  proxy as _proxy,
  transferHandlers as _transferHandlers,
  expose as _expose,
} from "comlinkjs";

import headersTransferHandler from "oxalis/workers/headers_transfer_handler";

_transferHandlers.set("Headers", headersTransferHandler);
export const createWorker: <Fn>(fn: Fn) => Fn = WorkerClass =>
  _proxy(
    // When importing a worker module, flow doesn't know that a special Worker class
    // is imported. Instead, flow thinks that the declared function is
    // directly imported. We exploit this by simply typing this createWorker function as an identity function
    // (T => T). That way, we gain proper flow typing for functions executed in web workers. However,
    // we need to suppress the following flow error for that to work.
    // $FlowFixMe
    new WorkerClass(),
  );

export const proxy = _proxy;
export const transferHandlers = _transferHandlers;
export const expose = <T>(fn: T, _self: any): T => {
  _expose(fn, _self);
  return fn;
};
