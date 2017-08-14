// In test environments, we don't want keyboardJS to fail immediately, only
// because it can't find addEventListener. So, let's emulate it here.

if (!global.addEventListener) {
  global.addEventListener = function noop() {};
  global.document = { addEventListener() {} };
}

const KeyboardJS = require("libs/keyboard");

export default KeyboardJS;
