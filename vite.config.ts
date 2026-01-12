import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import viteProtobufPlugin from "./vite-plugin-protobuf";
import wasm from "vite-plugin-wasm";

import path from "node:path";

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
    react({ skipFastRefresh: true, fastRefresh: false }),
    tsconfigPaths(),
    wasm(),
    viteProtobufPlugin({
      protoDir: "webknossos-datastore/proto", // Your proto directory
    }),
  ],
  optimizeDeps: {
    exclude: ["three-mesh-bvh"],
  },
  build: {
    copyPublicDir: true,
    outDir: "public",
    emptyOutDir: false,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules")) {
            return "vendor";
          }
        },
      },
    },
  },
  server: {
    port: 9000,
    cors: true,
    proxy: {
      // You can add more routes here, e.g. "^/(api|binary|auth)"
      "^/(api|data|tracings)": {
        target: "http://localhost:9001",
        changeOrigin: true,
      },
    },
    hmr: false,
  },
  define: {
    global: "globalThis",
  },
};

export default defineConfig(viteConfig);
