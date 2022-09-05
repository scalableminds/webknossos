// This module should be used to access the window object, so it can be mocked in the unit tests
// mockRequire("libs/window", myFakeWindow);
const removeEventListener = (
  _type: string,
  _fn: Function,
  _options?: boolean | EventListenerOptions,
) => {};
const addEventListener = (
  _type: string,
  _fn: Function,
  _options?: boolean | EventListenerOptions,
) => {};

export const alert = typeof window === "undefined" ? console.log.bind(console) : window.alert;
export const document =
  typeof window === "undefined" || !window.document
    ? {
        getElementById: () => null,
        body: null,
        activeElement: typeof HTMLElement === "undefined" ? undefined : HTMLElement,
        addEventListener,
        removeEventListener,
        createElement: <K extends keyof HTMLElementTagNameMap>(
          _tagName: K,
          _options?: ElementCreationOptions,
        ): HTMLElementTagNameMap[K] => {
          throw new Error("Cannot createElement, because no HTML context exists.");
        },
      }
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
  reload: () => {},

  /* noop */
  assign: () => {},

  /* noop */
  replace: () => {},

  /* noop */
  toString: () => "",
  /* noop */
};
// @ts-expect-error ts-migrate(2322) FIXME: Type 'Location | { ancestorOrigins: never[]; hash:... Remove this comment to see the full error message
export const location: Location = typeof window === "undefined" ? dummyLocation : window.location;

let performanceCounterForMocking = 0;

const _window =
  typeof window === "undefined"
    ? ({
        alert: console.log.bind(console),
        app: null,
        location: dummyLocation,
        requestAnimationFrame: (resolver: any) => {
          setTimeout(resolver, 16);
        },
        document,
        navigator: {
          onLine: true,
        },
        pageXOffset: 0,
        pageYOffset: 0,
        addEventListener,
        removeEventListener,
        open: (_url: string) => {},
        performance: { now: () => ++performanceCounterForMocking },
      } as typeof window)
    : window;

export default _window;
