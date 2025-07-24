const esbuild = require("esbuild");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");

const srcPath = path.resolve(__dirname, "frontend/javascripts/");
const outputPath  = path.resolve(__dirname, "public/bundle/");
const protoPath = path.join(__dirname, "webknossos-datastore/proto");

// Community plugins
const browserslistToEsbuild = require("browserslist-to-esbuild");
const { lessLoader } = require("esbuild-plugin-less");
const copyPlugin = require("esbuild-plugin-copy").default;
const polyfillNode = require("esbuild-plugin-polyfill-node").polyfillNode;
const esbuildPluginWorker = require("@chialab/esbuild-plugin-worker").default;


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

async function build(env = {}) {
  const isProduction = env.production || process.env.NODE_ENV === "production";
  const isWatch = env.watch;

  // Determine output directory for bundles.
  // In watch mode, it's a temp dir. In production, it's the public bundle dir.
  const buildOutDir = isWatch
    ? fs.mkdtempSync(path.join(os.tmpdir(), "esbuild-dev"))
    : outputPath;

  // Base plugins
  const plugins = [
    polyfillNode(),
    createProtoPlugin(protoPath),
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
    createWorkerPlugin(buildOutDir, srcPath, target, polyfillNode, lessLoader, __dirname, env.logLevel), // Resolves import Worker from myFunc.worker;
    esbuildPluginWorker() // Resolves new Worker(myWorker.js)
  ];


  const buildOptions = {
    entryPoints: {
      main: path.resolve(srcPath, "main.tsx"),
      // generateMeshBVHWorker: require.resolve("three-mesh-bvh/src/workers/generateMeshBVH.worker.js"),

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
      "global": "window"
    },
    loader: {
      ".woff": "file",
      ".woff2": "file",
      ".ttf": "file",
      ".eot": "file",
      ".svg": "file",
      ".png": "file",
      ".jpg": "file",
      ".wasm": "file",
    },
    resolveExtensions: [".ts", ".tsx", ".js", ".json", ".proto", ".wasm"],
    alias: {
      react: path.resolve(__dirname, "node_modules/react"),
      three: path.resolve(__dirname, "node_modules/three/src/Three.js"),
      url: require.resolve("url/"),
    },
    plugins: plugins,
    external: ["/assets/images/*", "fs", "path", "util", "module"],
    publicPath: "/assets/bundle/",
    metafile: !isWatch, // Don"t generate metafile for dev server
    logOverride: {
      "direct-eval": "silent",
    },
  };
  
  if (env.watch) {
    // Development server mode
    const ctx = await esbuild.context(buildOptions);
    
    const { host, port } = await ctx.serve({
      servedir: buildOutDir,
      port: env.PORT || 9002,
      onRequest: (args) => {
        if (env.logLevel === "verbose") {
          console.log(`[${args.method}] ${args.path} - status ${args.status}`);
        }
      },
    });
    
    console.log(`Development server running at http://${host}:${port}`);
    console.log(`Serving files from temporary directory: ${buildOutDir}`);
    
    await ctx.watch();
    
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