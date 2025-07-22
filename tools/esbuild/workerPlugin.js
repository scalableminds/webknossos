// esbuild plugin for handling web workers.
// This plugin identifies .worker.ts files, creates separate esbuild bundles for each,
// and provides a virtual module that exports the URL to the bundled worker file.

const esbuild = require("esbuild");
const path = require("node:path");

// Custom worker plugin that creates separate bundles for .worker.ts files
const createWorkerPlugin = (buildOutDir, srcPath, target, polyfillNode, lessLoader, projectRoot, logLevel) => ({
  name: "worker",
  setup(build) {
    const isProduction = process.env.NODE_ENV === "production";
    const workerEntries = new Map();
    
    // Collect all worker files during the resolve phase
    build.onResolve({ filter: /\.worker$/ }, (args) => {
      const workerPath = path.resolve(srcPath, args.path + ".ts");
      const workerName = path.basename(args.path, ".worker.ts");
      const workerOutputPath = `${workerName}.js`;
      
      workerEntries.set(workerPath, workerOutputPath);
      
      // Return a virtual module that exports the worker URL
      return {
        path: args.path,
        namespace: "worker-url",
      };
    });
    
    // Handle the virtual worker URL modules
    build.onLoad({ filter: /.*/, namespace: "worker-url" }, (args) => {
      const workerName = path.basename(args.path, ".worker.ts");
      const workerUrl = `/assets/bundle/${workerName}.js`;
      
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
          await esbuild.build({
            entryPoints: [workerPath],
            bundle: true,
            format: "iife",
            target: target,
            outfile: path.join(buildOutDir, workerOutputPath),
            minify: isProduction,
            sourcemap: isProduction ? "external" : "inline",
            define: {
              "process.env.NODE_ENV": JSON.stringify(isProduction ? "production" : "development"),
            },
            alias: {
              react: path.resolve(projectRoot, "node_modules/react"),
              three: path.resolve(projectRoot, "node_modules/three/src/Three.js"),
              url: require.resolve("url/"),
            },
            external: [], // Bundle everything for workers
            // Don"t inject process-shim in workers
            inject: [],
            resolveExtensions: [".ts", ".tsx", ".js", ".json"],
            plugins: [
              polyfillNode(),
              lessLoader({
                javascriptEnabled: true,
              }),
            ],
            loader: {".wasm": "file"}
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