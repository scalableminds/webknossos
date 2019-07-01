// @noflow
// In test environments, we don't want HammerJS to fail immediately, only
// because it can't find window. So, let's emulate it here.

const oldDocument = typeof document === "undefined" ? undefined : document;
const oldWindow = typeof window === "undefined" ? undefined : window;
let mockedWindow = false;
if (!global.window) {
  global.window = {
    location: {
      protocol: "",
    },
  };
  global.document = {
    createElement: () => ({ style: {} }),
  };
  mockedWindow = true;
}

const Hammer = require("hammerjs");

if (mockedWindow) {
  // Reset to old values, otherwise other libs may not detect a test environment
  global.document = oldDocument;
  global.window = oldWindow;
}

export default Hammer;
