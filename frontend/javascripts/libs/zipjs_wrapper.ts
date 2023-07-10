class TransFormStream {}

let mockedWindow = false;

// Mock zip.js and TransformStream during tests
if (!global.window) {
  // @ts-expect-error
  global.TransformStream = TransFormStream;
  mockedWindow = true;
}

const Zip = require("@zip.js/zip.js");

export default Zip;
