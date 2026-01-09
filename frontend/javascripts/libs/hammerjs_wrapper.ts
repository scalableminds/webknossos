// In test environments, we don't want HammerJS to fail immediately, only
// because it can't find window. So, let's emulate it here.
const oldDocument = typeof document === "undefined" ? undefined : document;
const oldWindow = typeof window === "undefined" ? undefined : window;
let mockedWindow = false;

if (import.meta.env.MODE === "test" && !global.window) {
  global.window = {
    // @ts-expect-error ts-migrate(2740) FIXME: Type '{ protocol: string; }' is missing the follow... Remove this comment to see the full error message
    location: {
      protocol: "",
    },
  };
  global.document = {
    // @ts-expect-error ts-migrate(2322) FIXME: Type '{ style: {}; }' is not assignable to type 'H... Remove this comment to see the full error message
    createElement: () => ({
      style: {},
    }),
  };
  mockedWindow = true;
}

import Hammer from "hammerjs";

if (mockedWindow) {
  // Reset to old values, otherwise other libs may not detect a test environment
  // @ts-expect-error ts-migrate(2322) FIXME: Type 'Document | undefined' is not assignable to t... Remove this comment to see the full error message
  global.document = oldDocument;
  // @ts-expect-error ts-migrate(2322) FIXME: Type '(Window & typeof globalThis) | undefined' is... Remove this comment to see the full error message
  global.window = oldWindow;
}

export default Hammer;
