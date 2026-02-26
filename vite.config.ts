import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import svgr from "vite-plugin-svgr";
import viteProtobufPlugin from "./frontend/vite/vite-plugin-protobuf";
import wasm from "vite-plugin-wasm";
import analyzer from "vite-bundle-analyzer";

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
    react(),
    svgr({
      svgrOptions: { icon: true },
    }),
    tsconfigPaths(),
    wasm(),
    viteProtobufPlugin({
      protoDir: "webknossos-datastore/proto",
    }),
  ],
  optimizeDeps: {
    exclude: ["three-mesh-bvh", "ndarray", "ndarray-ops", "ndarray-moments"],
  },
  build: {
    copyPublicDir: true, // copy all /assets (images, etc.) to public/assets
    outDir: "public", // note: /public is handled by the backend/Play framework for asset delivery
    emptyOutDir: true,
    sourcemap: true,
    minify: false,
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
