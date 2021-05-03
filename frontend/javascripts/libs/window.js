// @noflow
// This module should be used to access the window object, so it can be mocked in the unit tests
// mockRequire("libs/window", myFakeWindow);
export const alert = typeof window === "undefined" ? console.log.bind(console) : window.alert;
export const document =
  typeof window === "undefined" || !window.document
    ? { getElementById: () => null }
    : window.document;

// See https://github.com/facebook/flow/blob/master/lib/bom.js#L294-L311
const dummyLocation = {
  ancestorOrigins: [],
  hash: "",
  host: "",
  hostname: "",
  href: "",
  origin: "",
  pathname: "",
  port: "",
  protocol: "",
  search: "",
  reload: () => {} /* noop */,
  assign: () => {} /* noop */,
  replace: () => {} /* noop */,
  toString: () => "" /* noop */,
};
export const location: Location = typeof window === "undefined" ? dummyLocation : window.location;

const _window =
  typeof window === "undefined"
    ? {
        alert: console.log.bind(console),
        app: null,
        location: dummyLocation,
        requestAnimationFrame: resolve => resolve(),
        document,
      }
    : window;

export default _window;
