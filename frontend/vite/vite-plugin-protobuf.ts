import path from "node:path";
import protobuf from "protobufjs";
import type { Plugin } from "vite";

interface ProtobufPluginOptions {
  /**
   * Base directory for proto files (relative to project root)
   * @default 'proto'
   */
  protoDir?: string;
}

export default function viteProtobufPlugin(options: ProtobufPluginOptions = {}): Plugin {
  const { protoDir = "proto" } = options;

  return {
    name: "vite-plugin-protobuf",

    // Handle .proto file imports
    async transform(_code, id) {
      // Check if this is a .proto file
      if (!id.endsWith(".proto")) {
        return null;
      }

      try {
        // Load and parse the proto file
        const root = protobuf.loadSync(id);

        // Convert to JSON descriptor
        const json = root.toJSON();

        // Return as ES module with default export
        return {
          code: `export default ${JSON.stringify(json, null, 2)};`,
          map: null,
        };
      } catch (error) {
        this.error(`Failed to load proto file: ${id}\n${error}`);
      }
    },

    // Ensure .proto files are handled
    resolveId(source) {
      if (source.endsWith(".proto")) {
        // Always resolve proto files relative to the proto directory
        const fileName = path.basename(source);
        return path.resolve(process.cwd(), protoDir, fileName);
      }
      return null;
    },
  };
}
