// esbuild plugin for bundling .proto files.
// This plugin resolves and loads .proto files using protobuf.js,
// converting them into a JSON representation that can be imported as a module.

const path = require('node:path');
const fs = require('node:fs');
const protobuf = require('protobufjs');

// Custom plugin for .proto files
const createProtoPlugin = (protoPath) => ({
  name: 'proto',
  setup(build) {
    const protoRoot = protoPath;

    // Handle .proto import resolution
    build.onResolve({ filter: /\.proto$/ }, args => {
      // Try to resolve relative to protoRoot
      const fullPath = path.resolve(protoRoot, args.path);

      if (fs.existsSync(fullPath)) {
        return { path: fullPath };
      }

      // Optionally: also check relative to importer
      const relativePath = path.resolve(path.dirname(args.importer), args.path);
      if (fs.existsSync(relativePath)) {
        return { path: relativePath };
      }

      return {
        errors: [{ text: "Could not resolve .proto file: ${args.path}" }],
      };
    });

    // Handle .proto file loading
    build.onLoad({ filter: /\.proto$/ }, async (args) => {
      try {
        const root = new protobuf.Root();

        // Resolve imports from protoRoot
        root.resolvePath = (_origin, target) => path.resolve(protoRoot, target);

        const loaded = await root.load(args.path);
        const json = loaded.toJSON();

        return {
          contents: `module.exports = ${JSON.stringify(json)};`, 
          loader: 'js',
        };
      } catch (error) {
        return {
          errors: [{ text: error.message, location: { file: args.path } }],
        };
      }
    });
  },
});

module.exports = { createProtoPlugin };