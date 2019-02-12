// @flow

export default function runAsync(
  functions: Array<Function>,
  waitTimeMs: number = 100,
): Promise<void> {
  // Executes a the list of functions, waiting `waitTimeMs` before executing
  // each of them. The functions can either return synchronous or return a
  // promise.

  return new Promise(resolve => {
    if (functions.length === 0) {
      resolve();
      return;
    }

    setTimeout(() => {
      const func = functions.shift();
      const result = func();
      const promise = result instanceof Promise ? result : Promise.resolve();
      promise.then(() => runAsync(functions, waitTimeMs).then(resolve));
    }, waitTimeMs);
  });
}
