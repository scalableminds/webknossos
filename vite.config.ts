import { defineConfig } from "vite";
import babel from "@rolldown/plugin-babel";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import svgr from "vite-plugin-svgr";
import wasm from "vite-plugin-wasm";
import analyzer from "vite-bundle-analyzer";
import viteProtobufPlugin from "./frontend/vite/vite-plugin-protobuf";
import replaceSvgColorWithCurrentColor from "./frontend/vite/vite-plugin-replace-svg-color";

import path from "node:path";
import fs from "node:fs";

const alias = {
  "@images": path.resolve(__dirname, "frontend/assets/images"),
  "@wasm": path.resolve(__dirname, "frontend/assets/wasm"),
};

// https://vite.dev/config/
export const viteConfig = {
  resolve: { alias, tsconfigPaths: true },
  plugins: [
    // analyzer(), // Enable/Disable vite bundle analyzer for inspecting the output bundle
    react(),
    babel({
      presets: [reactCompilerPreset()],
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
    wasm(),
    viteProtobufPlugin({
      protoDir: "webknossos-datastore/proto",
    }),
  ],
  optimizeDeps: {
    exclude: ["three-mesh-bvh"],
  },
  build: {
    outDir: "public", // note: /public is handled by the backend/Play framework for asset delivery
    emptyOutDir: true,
    sourcemap: true,
    rolldownOptions: {
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
        "**/frontend/javascripts/test/**",
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
        "**/test/**",
      ],
    },
  },
  define: {
    global: "globalThis",
  },
};

export default defineConfig(viteConfig);
