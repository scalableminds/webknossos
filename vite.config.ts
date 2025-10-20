import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import viteProtobufPlugin from "./vite-plugin-protobuf";
import wasm from "vite-plugin-wasm";

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tsconfigPaths(),
    wasm,
    viteProtobufPlugin({
      protoDir: "webknossos-datastore/proto", // Your proto directory
    }),
  ],
});
