/**
 * @summary Custom esbuild plugin for bundling web workers.
 * @description
 * This plugin finds files ending with the `.worker.ts` suffix, bundles each into a
 * separate bundle file, and provides the URL to the bundled worker script to the main
 * application.
 *
 * It works in three stages:
 * 1. `onResolve` intercepts imports for `.worker` files and registers them.
 * 2. `onLoad` replaces the import with a URL string pointing to the future worker bundle.
 * 3. `onEnd` runs a separate esbuild process for each registered worker to create the
 *    final bundle.
 *
 * @example
 * // This allows for a clean import of worker URLs:
 * import workerUrl from './my.worker';
 * const worker = new Worker(workerUrl);
 */

const esbuild = require("esbuild");
const path = require("node:path");

// Custom worker plugin that creates separate bundles for .worker.ts files
// DRY: reuses the main esbuild config (initialOptions) and only overrides worker-specific bits
const createWorkerPlugin = ({ logLevel = "info" } = {}) => ({
  name: "wk-worker-bundler",
  setup(build) {
    const workerEntries = new Map();
    const initial = build.initialOptions || {};
    const absWorkingDir = initial.absWorkingDir || process.cwd();
    const outdir = initial.outdir || absWorkingDir;
    const publicPathRaw = initial.publicPath || "/";
    const publicPath = publicPathRaw.endsWith("/") ? publicPathRaw : `${publicPathRaw}/`;
    const srcRoot = path.resolve(absWorkingDir, "frontend/javascripts");
    
    // Collect all worker files during the resolve phase
    build.onResolve({ filter: /\.worker$/ }, (args) => {
      const isBare = !args.path.startsWith(".") && !path.isAbsolute(args.path);
      const baseDir = isBare ? srcRoot : (args.resolveDir || absWorkingDir);
      const resolvedWorkerPath = path.resolve(baseDir, `${args.path}.ts`);
      // Maintain previous behavior: strip the .worker suffix in the output filename
      const workerBaseName = path.basename(args.path, ".worker");
      const workerOutputPath = `${workerBaseName}.js`;
      
      workerEntries.set(resolvedWorkerPath, workerOutputPath);
      
      // Return a virtual module that exports the worker URL
      return {
        path: args.path,
        namespace: "worker-url",
      };
    });
    
    // Handle the virtual worker URL modules
    build.onLoad({ filter: /.*/, namespace: "worker-url" }, (args) => {
      const workerBaseName = path.basename(args.path, ".worker");
      const workerUrl = `${publicPath}${workerBaseName}.js`;
      
      return {
        contents: `export default "${workerUrl}";`,
        loader: "js",
      };
    });

    // Build all worker bundles at the end
    build.onEnd(async (result) => {
      if (result.errors.length > 0) return;
      
      for (const [workerPath, workerOutputPath] of workerEntries) {
        try {
          // Base on main build config and override worker-specific parts
          const basePlugins = Array.isArray(initial.plugins) ? initial.plugins : [];
          // Exclude any worker-related
          const workerPlugins = basePlugins.filter((p) => p && typeof p.name === "string" && !/worker/i.test(p.name));

          await esbuild.build({
            ...initial,
            entryPoints: [workerPath],
            outfile: path.join(outdir, workerOutputPath),
            outdir: undefined, // ensure single-file output via outfile
            splitting: false, // keep worker as a single file
            external: [],
            plugins: workerPlugins,
          });
          
          if (logLevel !== "silent") {
            console.log(`✓ Built worker: ${workerOutputPath}`);
          }
        } catch (error) {
          console.error(`✗ Failed to build worker ${workerOutputPath}:`, error.message);
          result.errors.push({
            text: `Worker build failed: ${error.message}`,
            location: { file: workerPath },
          });
        }
      }
    });
  },
});

module.exports = { createWorkerPlugin };