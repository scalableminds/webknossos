import * as ZipType from "@zip.js/zip.js";

class TransFormStream {}

// Mock zip.js and TransformStream during tests
if (!global.window) {
  // @ts-expect-error
  global.TransformStream = TransFormStream;
}

const Zip = require("@zip.js/zip.js") as typeof ZipType;

export default Zip;
