/**
 * Executes a list of functions asynchronously with a delay between each execution.
 * Each function can return either a synchronous value or a Promise.
 *
 * @param functions An array of functions to execute. Each function should accept no arguments.
 * @param waitTimeMs The time to wait (in milliseconds) before executing each function. Defaults to 100ms.
 * @returns A Promise that resolves when all functions have been executed.
 */
export default function runAsync(
  functions: Array<() => any | Promise<any>>,
  waitTimeMs: number = 100,
): Promise<void> {
  return new Promise<void>((resolve) => {
    if (functions.length === 0) {
      resolve();
      return;
    }

    setTimeout(() => {
      const func = functions.shift();
      if (func) {
        const result = func();
        const promise = result instanceof Promise ? result : Promise.resolve(result);
        promise.then(() => runAsync(functions, waitTimeMs).then(resolve));
      } else {
        resolve(); // Resolve if func is undefined (shouldn't happen, but safe)
      }
    }, waitTimeMs);
  });
}
