export default function runAsync(
  functions: Array<(...args: Array<any>) => any>,
  waitTimeMs: number = 100,
): Promise<void> {
  // Executes a the list of functions, waiting `waitTimeMs` before executing
  // each of them. The functions can either return synchronous or return a
  // promise.
  return new Promise((resolve) => {
    if (functions.length === 0) {
      resolve();
      return;
    }

    setTimeout(() => {
      const func = functions.shift();
      // @ts-expect-error ts-migrate(2532) FIXME: Object is possibly 'undefined'.
      const result = func();
      const promise = result instanceof Promise ? result : Promise.resolve();
      promise.then(() => runAsync(functions, waitTimeMs).then(resolve));
    }, waitTimeMs);
  });
}
