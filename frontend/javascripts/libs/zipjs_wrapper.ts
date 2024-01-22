import * as ZipType from "@zip.js/zip.js";

class TransFormStream {}

// Mock zip.js and TransformStream during tests
if (!global.window) {
  // @ts-expect-error
  global.TransformStream = TransFormStream;
}

const Zip = require("@zip.js/zip.js") as typeof ZipType;

Zip.configure({
  // Avoid that zip.js dynamically creates a web worker using new Blob(...) which would violate the CSP,
  // see https://github.com/gildas-lormeau/zip.js/blob/62126066df4a90fb6048e95aa5f71dcdc6cf9c4a/index.d.ts#L72
  workerScripts: {
    deflate: ["z-worker.js"],
    inflate: ["z-worker.js"],
  },
});

export default Zip;
