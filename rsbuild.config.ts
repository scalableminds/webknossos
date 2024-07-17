import { defineConfig } from "@rsbuild/core";
import { pluginReact } from "@rsbuild/plugin-react";
import { pluginLess } from "@rsbuild/plugin-less";

import path from "node:path";

const srcPath = path.resolve(__dirname, "frontend/javascripts/");
const nodePath = "node_modules";
const protoPath = path.join(__dirname, "webknossos-datastore/proto/");
const publicPath = path.resolve(__dirname, "public/");


export default defineConfig({
  plugins: [pluginReact(), pluginLess()],
  source: {
    entry: {
      main: path.join(srcPath, "/main.tsx"),
    },

    include: [srcPath, publicPath, protoPath],
    alias: {
      "/assets/*": false,
      "/assets/images": false,
      "/assets/images/pricing/*": false,
      "/assets/images/drawings/*": false,
    },
  },
  output: {
    distPath:{
        root: publicPath, 
        js: "bundle",
    },
    emitAssets: false
  },
  performance: {
    chunkSplit: {
      strategy: "single-vendor",
    },
  },
  server: {
    publicDir: {
      name: "public",
      copyOnBuild: false,
    },
  },
});
