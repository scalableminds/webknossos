import { type UseCreateWorkerToUseMe, wrap } from "./comlink_core";

export { expose, transfer } from "./comlink_core";

// Worker modules export bare functions. In the browser (Vite), we use the web workers
// to instantiate them. In Node (Vitest), we dynamically import the worker module
// and execute the function directly.
// To gain type safety for all usages of web worker modules, we cheat a bit with the typing.
// In reality, `expose` receives a function and returns it again. However, we tell TypeScript
// that it wraps the function, so that unwrapping becomes necessary.
// The unwrapping is done with `createWorker` which either instantiates the web worker module
// or returns the dynamically imported function.

type AnyFn = (...args: any[]) => any;
type UnwrapExposedWorkerFn<T> = T extends UseCreateWorkerToUseMe<infer Fn extends AnyFn> ? Fn : T;

export function createWorker<TExposed extends UseCreateWorkerToUseMe<AnyFn> | AnyFn>(
  pathToWorker: string,
): (
  ...params: Parameters<UnwrapExposedWorkerFn<TExposed>>
) => Promise<Awaited<ReturnType<UnwrapExposedWorkerFn<TExposed>>>> {
  if (wrap == null) {
    // In a node context (e.g., when executing tests), we don't create web workers.
    // Instead, we dynamically import the worker and return its default export.
    return async (...params: Parameters<UnwrapExposedWorkerFn<TExposed>>) => {
      const pathToWorkerWithoutExtension = pathToWorker.replace(/\.worker\.ts$/, "");
      // This import statement requires a file extension for proper static analysis by Vite during build step.
      const workerModule = await import(`./${pathToWorkerWithoutExtension}.worker.ts`);
      return workerModule.default(...params);
    };
  }

  // this URL is relative to <root>/frontend/javascripts/viewer/workers
  const workerConstructors = import.meta.glob("./*.worker.ts", {
    query: "?worker",
    import: "default",
    eager: true,
  });
  const workerConstructor = workerConstructors[`./${pathToWorker}`] as
    | (new (
        options?: WorkerOptions,
      ) => Worker)
    | undefined;

  if (workerConstructor == null) {
    throw new Error(`Worker not found: ${pathToWorker}`);
  }

  return wrap(new workerConstructor({ type: "module" }));
}
