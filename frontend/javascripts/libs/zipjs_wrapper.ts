class TransFormStream {}

// In test environments, we don't want zipjs to fail immediately, only
// because it can't find window. So, let's emulate it here.
let mockedWindow = false;

if (!global.window) {
  // @ts-expect-error
  global.TransformStream = TransFormStream;
  mockedWindow = true;
}

const Zip = require("@zip.js/zip.js");

export default Zip;
