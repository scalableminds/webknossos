import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import svgr from "vite-plugin-svgr";
import wasm from "vite-plugin-wasm";
import analyzer from "vite-bundle-analyzer";
import viteProtobufPlugin from "./frontend/vite/vite-plugin-protobuf";
import replaceSvgColorWithCurrentColor from "./frontend/vite/vite-plugin-replace-svg-color";

import path from "node:path";
import fs from "node:fs";

// This alias is mostly for resolves in LESS-files
// Code-related resolves are handled by "paths" in tsconfig.ts, tsconfigPaths-plugin respectively
const alias = {
  "@images": path.resolve(__dirname, "frontend/assets/images"),
  "@wasm": path.resolve(__dirname, "frontend/assets/wasm"),
};

// https://vite.dev/config/
export const viteConfig = {
  // publicDir: "/assets",
  resolve: { alias },
  plugins: [
    // analyzer(), // Enable/Disable vite bundle analyzer for inspecting the output bundle
    react({
      babel: {
        plugins: ["babel-plugin-react-compiler"],
      },
    }),
    svgr({
      svgrOptions: {
        icon: true,
        jsx: {
          babelConfig: {
            plugins: [[replaceSvgColorWithCurrentColor, { patchStroke: true, patchFill: false }]],
          },
        },
      },
    }),
    tsconfigPaths(),
    wasm(),
    viteProtobufPlugin({
      protoDir: "webknossos-datastore/proto",
    }),
  ],
  optimizeDeps: {
    exclude: ["three-mesh-bvh"],
  },
  build: {
    copyPublicDir: true, // copy all /assets (images, etc.) to public/assets
    outDir: "public", // note: /public is handled by the backend/Play framework for asset delivery
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules/html2canvas")) {
            return "html2canvas";
          }
        },
      },
    },
  },
  worker: {
    format: "es",
    plugins: () => [wasm(), tsconfigPaths()],
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
