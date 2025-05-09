import { ApiType } from "viewer/api/api_loader"
import WkDev from "viewer/api/wk_dev";

declare global {
  interface Window {
    needsRerender: boolean;
    webknossos: {
      DEV: WkDev;
      apiReady: ApiType["apiReady"]
    };
  }
}

// https://stackoverflow.com/questions/49285864/is-there-a-valueof-similar-to-keyof-in-typescript
export type ValueOf<T> = T[keyof T];
export type EmptyObject = Record<string, never>;
export type ArbitraryObject = Record<string, any>;
export type ArbitraryFunction = (...args: Array<any>) => any;
export type Comparator<T> = (arg0: T, arg1: T) => -1 | 0 | 1;
export type ArrayElement<A> = A extends readonly (infer T)[] ? T : never;
export type Mutable<T> = {
  -readonly [K in keyof T]: T[K];
};
