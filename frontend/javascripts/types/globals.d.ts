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

  // This is a helper interface that can be implemented by custom collections
  // to ensure that Object.{keys,values,entries} is not used on them (as TS
  // will happily allow this while being most likely not what was intended).
  interface NotEnumerableByObject {
    __notEnumerableByObject: true;
  }

  interface ObjectConstructor {
    keys<T extends NotEnumerableByObject>(obj: T): never;
    values<T extends NotEnumerableByObject>(obj: T): never;
    entries<T extends NotEnumerableByObject>(obj: T): never;
  }

}

// Typescript utility types:
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
export type Writeable<T> = { -readonly [P in keyof T]: T[P] };

