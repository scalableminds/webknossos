import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import svgr from "vite-plugin-svgr";
import viteProtobufPlugin from "./frontend/vite/vite-plugin-protobuf";
import wasm from "vite-plugin-wasm";
import analyzer from "vite-bundle-analyzer";

import path from "node:path";
import fs from "node:fs";

// https://vite.dev/config/

export const viteConfig = {
  publicDir: "frontend/assets",
  resolve: {
    alias: {
      libs: path.resolve(__dirname, "frontend/javascripts/libs"),
      viewer: path.resolve(__dirname, "frontend/javascripts/viewer"),
      admin: path.resolve(__dirname, "frontend/javascripts/admin"),
      types: path.resolve(__dirname, "frontend/javascripts/types"),
      dashboard: path.resolve(__dirname, "frontend/javascripts/dashboard"),
      router: path.resolve(__dirname, "frontend/javascripts/router"),
      messages: path.resolve(__dirname, "frontend/javascripts/messages.tsx"),
      app: path.resolve(__dirname, "frontend/javascripts/app.ts"),
      theme: path.resolve(__dirname, "frontend/javascripts/theme.tsx"),
    },
  },
  plugins: [
    // analyzer(), // Enable/Disable vite bundle analyzer for inspecting the output bundle
    react(),
    svgr({ svgrOptions: { icon: true } }),
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
    copyPublicDir: true, // copy all frontend/assets (images, etc.) to public/assets
    outDir: "public", // note: /public is handled by the backend/Play framework for asset delivery
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules/html2canvas")) {
            return "html2canvas";
          }
          // if (id.includes("node_modules")) {
          //   return "vendor";
          // }
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
    //   // Make sure you've generated SSL certificates using the ./tools/proxy/gen-ssl-dev-certs.sh script
    //   key: fs.readFileSync("./target/dev.key.pem"),
    //   cert: fs.readFileSync("./target/dev.cert.pem"),
    // },
    proxy: {
      // You can add more routes here, e.g. "^/(api|binary|auth)"
      "^/dist/": {
        target: "http://localhost:8080",
        changeOrigin: true,
      },
      "^/(api|data(?!set)|tracings)": {
        target: "http://localhost:9001",
        changeOrigin: true,
      },
    },
    hmr: false, // disable Hot Module Replacement for now
  },
  define: {
    global: "globalThis",
  },
};

export default defineConfig(viteConfig);
