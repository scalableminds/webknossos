import path from "node:path";
import babel from "@rolldown/plugin-babel";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import svgr from "vite-plugin-svgr";
import assertCodeSplitting from "./frontend/vite/vite-plugin-assert-code-splitting";
import assertWorkerPurity from "./frontend/vite/vite-plugin-assert-worker-purity";
import viteProtobufPlugin from "./frontend/vite/vite-plugin-protobuf";
import replaceSvgColorWithCurrentColor from "./frontend/vite/vite-plugin-replace-svg-color";

const alias = {
  "@images": path.resolve(__dirname, "frontend/assets/images"),
  "@wasm": path.resolve(__dirname, "frontend/assets/wasm"),
};

// https://vite.dev/config/
const viteConfig = {
  resolve: { alias, tsconfigPaths: true },
  plugins: [
    react(),
    babel({
      presets: [reactCompilerPreset()],
    }),
    svgr({
      svgrOptions: {
        plugins: ["@svgr/plugin-svgo", "@svgr/plugin-jsx"],
        icon: true,
        jsx: {
          babelConfig: {
            plugins: [[replaceSvgColorWithCurrentColor, { patchStroke: true, patchFill: true }]],
          },
        },
        svgoConfig: {
          plugins: [
            { name: "convertStyleToAttrs" }, // converts <SVG style="..."> to individual attrs
            {
              name: "preset-default",
              params: {
                overrides: {
                  // Keep the viewBox so that icons scale with the 1em size set by svgr's icon option.
                  // Otherwise, icons whose width/height match the viewBox would be clipped.
                  removeViewBox: false,
                },
              },
            },
          ],
        },
      },
    }),
    viteProtobufPlugin({
      protoDir: "webknossos-datastore/proto",
    }),
    assertCodeSplitting({
      entry: "frontend/javascripts/main.tsx",
      lazyEntries: ["frontend/javascripts/viewer/viewer_entry.ts"],
      // Markers of the viewer that must only load with viewer_entry. Not exhaustive: the budget
      // below catches the rest, these name the culprit.
      forbiddenInInitialPayload: [
        ["three.js", /node_modules\/(three|three-mesh-bvh|@tweenjs)\//],
        ["protobufjs", /node_modules\/protobufjs\//],
        ["flexlayout-react", /node_modules\/flexlayout-react\//],
        ["the Model", /[\\/]viewer[\\/]model\.ts$/],
        ["the root saga", /[\\/]viewer[\\/]model[\\/]sagas[\\/]root_saga\.ts$/],
        ["the root reducer", /[\\/]viewer[\\/]model[\\/]reducers[\\/]root_reducer\.ts$/],
        ["the viewer layout", /[\\/]viewer[\\/]view[\\/]layouting[\\/]tracing_layout_view\.tsx$/],
        ["the controllers", /[\\/]viewer[\\/]controller(\.tsx$|[\\/])/],
        ["the geometries and shaders", /[\\/]viewer[\\/](geometries|shaders)[\\/]/],
      ],
      // Gzipped JS + CSS loaded upfront by every page (1,026 kB as of #10088).
      initialPayloadBudgetKb: 1050,
    }),
  ],
  devtools: {
    enabled: false,
  },
  optimizeDeps: {
    exclude: ["three-mesh-bvh"],
  },
  build: {
    outDir: "public", // note: /public is handled by the backend/Play framework for asset delivery
    emptyOutDir: true,
    sourcemap: true,
  },
  worker: {
    format: "es" as const,
    // Vite bundles workers in a separate rolldown pass, so plugins that need to inspect
    // worker chunks have to be registered here rather than in `plugins` above.
    plugins: () => [assertWorkerPurity()],
  },
  server: {
    port: 9000,
    cors: true,
    // Start compiling the entry's module graph on server start instead of on the first page request.
    warmup: {
      clientFiles: ["./frontend/javascripts/main.tsx"],
    },
    // https: {
    //   // Enable HTTPS with self-signed certificates for testing passkeys etc
    //   // Make sure you've generated SSL certificates using the ./tools/gen-ssl-dev-certs.sh script
    //   key: fs.readFileSync("./target/dev.key.pem"),
    //   cert: fs.readFileSync("./target/dev.cert.pem"),
    // },
    proxy: {
      // Proxy to SAM service
      "^/dist/": {
        target: "http://localhost:8080",
        changeOrigin: true,
      },
      // Proxy to Tracingstore / Datastore
      "^/(api|data(?!set)|tracings)": {
        target: "http://localhost:9001",
        changeOrigin: true,
      },
    },
    hmr: process.env.VITE_HMR === "true", // disabled by default, opt in via VITE_HMR=true
    watch: {
      ignored: [
        "**/node_modules/**",
        ...[
          "dist",
          "app",
          "webknossos-tracingstore",
          "webknossos-datastore",
          "util",
          "webknossos-jni",
          "conf",
          "project",
          "docs",
          "fossildb",
          "target",
          "schema",
          "tools",
          "binaryData",
          "coverage",
          "public",
          "public-test",
          "unreleased_changes",
        ].map((dir) => path.resolve(__dirname, dir)),
      ],
    },
  },
  define: {
    // Vite does not automatically provide a `process` polyfill in the
    // browser. a) the frontend code still contains a few legacy
    // `process.env.*` checks and b) third‑party libraries might reference
    // `process.env.NODE_ENV`.  Without the mapping the dev server emits
    // `process.env` literally which crashes because `process` is undefined
    // in the browser.  We only need a *compile‑time* replacement; the real
    // object is never used at runtime.
    global: "globalThis",
    "process.env": {},
    // we keep NODE_ENV for compatibility with existing checks in the repo
    "process.env.NODE_ENV": JSON.stringify(process.env.NODE_ENV),
    // the only custom value that is currently used in the client is IS_TESTING
    "process.env.IS_TESTING": JSON.stringify(process.env.IS_TESTING ?? ""),
  },
};

export default defineConfig(viteConfig);
