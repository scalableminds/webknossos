const esbuild = require("esbuild");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");

const express = require("express");

const app = express();

const srcPath = path.resolve(__dirname, "frontend/javascripts/");
const outputPath  = path.resolve(__dirname, "public/bundle/");
const protoPath = path.join(__dirname, "webknossos-datastore/proto");

// Community plugins
const browserslistToEsbuild = require("browserslist-to-esbuild");
const { lessLoader } = require("esbuild-plugin-less");
const copyPlugin = require("esbuild-plugin-copy").default;
const polyfillNode = require("esbuild-plugin-polyfill-node").polyfillNode;
const esbuildPluginWorker = require("@chialab/esbuild-plugin-worker").default;
const { wasmLoader } = require("esbuild-plugin-wasm");

// Custom Plugins for Webknossos
const { createWorkerPlugin } = require("./tools/esbuild/workerPlugin.js");
const { createProtoPlugin } = require("./tools/esbuild/protoPlugin.js");

const target = browserslistToEsbuild([
  "last 3 Chrome versions",
  "last 3 Firefox versions",
  "last 2 Edge versions",
  "last 1 Safari versions",
  "last 1 iOS versions",
]);

function now() {
  const d = new Date();
  return d.toISOString().replace("T", " ").replace("Z", "");
}

async function build(env = {}) {
  const isProduction = env.production || process.env.NODE_ENV === "production";
  const isWatch = env.watch;

  // Determine output directory for bundles.
  // In watch mode, it's a temp dir. In production, it's the public bundle dir.
  const buildOutDir = isWatch
    ? path.join(os.tmpdir(), "webknossos-esbuild-dev")
    : outputPath;

  console.log("buildOutDir", buildOutDir);

  if (isWatch) {
    // Ensure a clean, stable directory for development builds
    fs.rmSync(buildOutDir, { recursive: true, force: true });
    fs.mkdirSync(buildOutDir, { recursive: true });
  }

  let onBuildDone = () => {}

  // Track ongoing builds so that incoming requests can be paused until all builds are finished.
  let currentBuildCount = 0;
  let buildStartTime = null;
  let buildCounterPlugin = {
    name: 'buildCounterPlugin',
    setup(build) {
      build.onStart(() => {
        if (currentBuildCount === 0) {
          buildStartTime = performance.now();
        }
        currentBuildCount++;
        console.log(now(), 'build started. currentBuildCount=', currentBuildCount)
      })
      build.onEnd(() => {
        currentBuildCount--;
        if (currentBuildCount === 0) {
          console.log("Build took", performance.now() - buildStartTime);
        }
        console.log(now(), 'build ended. currentBuildCount=', currentBuildCount)
        if (currentBuildCount === 0) {
          onBuildDone();
        }
      })
    },
  }

  const plugins = [
    polyfillNode(),
    createProtoPlugin(protoPath),
    wasmLoader(),
    lessLoader({
      javascriptEnabled: true,
    }),
    copyPlugin({
      patterns: [
        {
          from: "node_modules/@zip.js/zip.js/dist/z-worker.js",
          to: path.join(buildOutDir, "z-worker.js"),
        },
      ],
    }),
    createWorkerPlugin({ logLevel: env.logLevel }), // Resolves import Worker from myFunc.worker;
    esbuildPluginWorker(), // Resolves new Worker(myWorker.js)
    buildCounterPlugin
  ];


  const buildOptions = {
    entryPoints: {
      main: path.resolve(srcPath, "main.tsx"),
    },
    bundle: true,
    outdir: buildOutDir,
    format: "esm",
    target: target,
    platform: "browser",
    splitting: true,
    chunkNames: "[name].[hash]",
    assetNames: "[name].[hash]",
    sourcemap: isProduction ? "external" : "inline",
    minify: isProduction,
    define: {
      "process.env.NODE_ENV": JSON.stringify(isProduction ? "production" : "development"),
      "process.env.BABEL_ENV": JSON.stringify(process.env.BABEL_ENV || "development"),
      "process.browser": "true",
      "global": "globalThis"
    },
    loader: {
      ".woff": "file",
      ".woff2": "file",
      ".ttf": "file",
      ".eot": "file",
      ".svg": "file",
      ".png": "file",
      ".jpg": "file",
      ".jpeg": "file",
      ".gif": "file",
      ".webp": "file",
      ".ico": "file",
      ".mp4": "file",
      ".webm": "file",
      ".ogg": "file",
    },
    resolveExtensions: [".ts", ".tsx", ".js", ".json", ".proto", ".wasm"],
    alias: {
      react: path.resolve(__dirname, "node_modules/react"),
    },
    plugins,
    external: ["/assets/images/*", "fs"],
    logLevel: env.logLevel || "info",
    legalComments: isProduction ? "inline" : "none",
    publicPath: "/assets/bundle/",
    metafile: !isWatch, // Don't generate metafile for dev server
    logOverride: {
      "direct-eval": "silent",
    },
  };
  
  if (env.watch) {
    // Development server mode
    const ctx = await esbuild.context(buildOptions);
    const port = env.PORT || 9002;

    // queue for waiting requests
    let waiting = [];

    function gateMiddleware(req, res, next) {
      if (currentBuildCount === 0) {
        return next(); // allow immediately
      }

      // hold request
      waiting.push({ req, res, next });
    }

    app.use("/", gateMiddleware, express.static(buildOutDir));

    onBuildDone = function releaseRequests() {
      const queued = waiting;
      waiting = [];
      queued.forEach(({ next }) => {
        return next();
      });
    }

    app.listen(port, "127.0.0.1", () => {
      console.log(`Server running at http://localhost:${port}/assets/bundle/`);
    });
    
    console.log(`Development server running at http://localhost:${port}`);
    console.log(`Serving files from temporary directory: ${buildOutDir}`);
    
    process.on("SIGINT", async () => {
      await ctx.dispose();
      process.exit(0);
    });
  } else {
    // Production build
    const result = await esbuild.build(buildOptions);
    
    if (result.metafile) {
      await fs.promises.writeFile(
        path.join(buildOutDir, "metafile.json"),
        JSON.stringify(result.metafile, null, 2)
      );
    }
    
    console.log("Build completed successfully!");
  }
}

module.exports = { build };

// If called directly
if (require.main === module) {
  const args = process.argv.slice(2);
  const env = {
    logLevel: "info", // Default log level
  };
  
  args.forEach(arg => {
    if (arg === "--production") env.production = true;
    if (arg === "--watch") env.watch = true;
    if (arg.startsWith("--port=")) env.PORT = Number.parseInt(arg.split("=")[1]);
    if (arg === "--verbose") env.logLevel = "verbose";
    if (arg === "--silent") env.logLevel = "silent";
  });
  
  build(env).catch(console.error);
}
