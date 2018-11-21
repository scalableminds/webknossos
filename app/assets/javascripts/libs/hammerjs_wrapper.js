// In test environments, we don't want HammerJS to fail immediately, only
// because it can't find window. So, let's emulate it here.

if (!global.window) {
  global.window = {
    location: {
      protocol: "",
    },
  };
  global.document = {
    createElement: () => ({ style: {} }),
  };
}

const Hammer = require("hammerjs");

export default Hammer;
