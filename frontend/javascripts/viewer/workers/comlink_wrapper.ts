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
    // Instead, we dynamically import the worker and call its default export directly.
    const pathToWorkerWithoutExtension = pathToWorker.replace(/\.worker\.ts$/, "");
    // The import is kicked off eagerly (at createWorker() time) instead of on the first
    // call: worker functions are often invoked fire-and-forget (e.g. bucket compression),
    // so a first call late in a test could otherwise trigger the module load after Vitest
    // has torn down the test environment (EnvironmentTeardownError).
    // In the browser, workers are loaded via import.meta.glob with eager: true (see below),
    // which Vite resolves statically at build time — no runtime dynamic import() occurs there.
    // This import() is only reached in Vitest/Node where wrap is null and web workers don't
    // exist, so importDynamic's "stale chunk URL after deployment" protection does not apply.
    // Bare import is allowed here (whitelisted in tools/check-no-bare-dynamic-imports.js).
    //
    // This import statement requires a file extension for proper static analysis by Vite during build step.
    // @vite-ignore keeps Rolldown from emitting every worker module a second time as a lazy
    // main-thread chunk for this Vitest-only import (Vitest resolves it at runtime instead).
    const workerModulePromise = import(
      /* @vite-ignore */ `./${pathToWorkerWithoutExtension}.worker.ts`
    );
    return async (...params: Parameters<UnwrapExposedWorkerFn<TExposed>>) => {
      const workerModule = await workerModulePromise;
      return workerModule.default(...params);
    };
  }

  type WorkerConstructor = new (options?: WorkerOptions) => Worker;

  // this URL is relative to <root>/frontend/javascripts/viewer/workers
  // Since Vite 8, `?worker` glob imports are typed as `Worker` instances rather than
  // worker constructors. We provide the generic type argument to import.meta.glob
  // to avoid type-casting later. At runtime the value is Vite's `WorkerWrapper`
  // function, which must be invoked with `new`.
  const workerConstructors = import.meta.glob<WorkerConstructor>("./*.worker.ts", {
    query: "?worker",
    import: "default",
    eager: true,
  });

  const workerConstructor: WorkerConstructor | undefined = workerConstructors[`./${pathToWorker}`];

  if (workerConstructor == null) {
    throw new Error(`Worker not found: ${pathToWorker}`);
  }

  return wrap(new workerConstructor({ type: "module" }));
}
