import { defineConfig } from "vite";
import babel from "@rolldown/plugin-babel";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import svgr from "vite-plugin-svgr";
import wasm from "vite-plugin-wasm";
import viteProtobufPlugin from "./frontend/vite/vite-plugin-protobuf";
import replaceSvgColorWithCurrentColor from "./frontend/vite/vite-plugin-replace-svg-color";

import path from "node:path";

const alias = {
  "@images": path.resolve(__dirname, "frontend/assets/images"),
  "@wasm": path.resolve(__dirname, "frontend/assets/wasm"),
};

// https://vite.dev/config/
export const viteConfig = {
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
            },
          ],
        },
      },
    }),
    wasm(),
    viteProtobufPlugin({
      protoDir: "webknossos-datastore/proto",
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
    rolldownOptions: {
      output: {
        strictExecutionOrder: true,
        codeSplitting: {
          minSize: 250000, // 250KB global minimum chunk size to avoid small artifacts
          groups: [
            {
              name: "vendor",
              test: /[\\/]node_modules[\\/]/,
              minSize: 250000, // 250KB minimum size for vendor chunks
              maxSize: 1000000, // 1MB maximum size per vendor chunk (prevents monolithic bundle)
              priority: 10,
            },
          ],
        },
      },
    },
  },
  worker: {
    format: "es",
    plugins: () => [wasm()],
  },
  server: {
    port: 9000,
    cors: true,
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
    hmr: false, // disable Hot Module Replacement for now
    watch: {
      ignored: [
        "**/node_modules/**",
        "**/dist/**",
        "**/app/**",
        "**/webknossos-tracingstore/**",
        "**/webknossos-datastore/**",
        "**/util/**",
        "**/webknossos-jni/**",
        "**/conf/**",
        "**/project/**",
        "**/docs/**",
        "**/fossildb/**",
        "**/target/**",
        "**/schema/**",
        "**/tools/**",
        "**/binaryData/**",
        "**/coverage/**",
        "**/public/**",
        "**/public-test/**",
        "**/unreleased_changes/**",
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
