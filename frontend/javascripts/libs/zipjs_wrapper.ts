import type * as ZipType from "@zip.js/zip.js";

class TransFormStream {}

// Mock zip.js and TransformStream during tests
if (import.meta.env.MODE === "test") {
  // @ts-expect-error
  global.TransformStream = TransFormStream;
}

import * as Zip from "@zip.js/zip.js";

Zip.configure({
  // Avoid that zip.js dynamically creates a web worker using new Blob(...) which would violate the CSP,
  // see https://gildas-lormeau.github.io/zip.js/api/interfaces/Configuration.html#workerScripts
  workerScripts: {
    deflate: ["z-worker.js"],
    inflate: ["z-worker.js"],
  },
});

export default Zip;
