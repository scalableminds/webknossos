// This module should be used to access the window object, so it can be mocked in the unit tests

import type TextureBucketManager from "oxalis/model/bucket_data_handling/texture_bucket_manager";
import type { ArbitraryFunction, ArbitraryObject } from "types/globals";

const removeEventListener = (
  _type: string,
  _fn: ArbitraryFunction,
  _options?: boolean | EventListenerOptions,
) => {};
const addEventListener = (
  _type: string,
  _fn: ArbitraryFunction,
  _options?: boolean | EventListenerOptions,
) => {};

export const alert = typeof window === "undefined" ? console.log.bind(console) : window.alert;
export const document =
  typeof window === "undefined" || !window.document
    ? ({
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
      } as any as Document)
    : window.document;

// See https://github.com/facebook/flow/blob/master/lib/bom.js#L294-L311
const dummyLocation = {
  ancestorOrigins: [],
  hash: "",
  host: "localhost",
  hostname: "",
  href: "",
  origin: "",
  pathname: "",
  port: "",
  protocol: "http:",
  search: "",
  reload: () => {},

  /* noop */
  assign: () => {},

  /* noop */
  replace: () => {},

  /* noop */
  toString: () => "",
  /* noop */
} as any as Window["location"];
export const location: Location = typeof window === "undefined" ? dummyLocation : window.location;

let performanceCounterForMocking = 0;

type Olvy =
  | {
      init: (obj: ArbitraryObject) => void;
      getUnreadReleasesCount: (timestamp: string) => number;
      show: () => void;
      config: { target: string };
    }
  | undefined;

const _window: Window &
  typeof globalThis & {
    Olvy?: Olvy;
    OlvyConfig?: ArbitraryObject | null;
    managers?: Array<TextureBucketManager>;
    materials?: Record<string, THREE.ShaderMaterial>;
  } =
  typeof window === "undefined"
    ? ({
        alert: console.log.bind(console),
        app: null,
        location: dummyLocation,
        requestAnimationFrame: (resolver: ArbitraryFunction) => {
          setTimeout(resolver, 16);
        },
        document,
        navigator: {
          onLine: true,
        },
        pageXOffset: 0,
        pageYOffset: 0,
        Olvy: undefined,
        addEventListener,
        removeEventListener,
        open: (_url: string) => {},
        performance: { now: () => ++performanceCounterForMocking },
        matchMedia: () => false,
      } as typeof window)
    : window;

export default _window;
