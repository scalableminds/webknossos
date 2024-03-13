declare global {
  interface Window {
    needsRerender: boolean;
  }
}

// https://stackoverflow.com/questions/49285864/is-there-a-valueof-similar-to-keyof-in-typescript
type ValueOf<T> = T[keyof T];
type EmptyObject = Record<string, never>;
type ArbitraryObject = Record<string, any>;
type ArbitraryFunction = (...args: Array<any>) => any;
export { ValueOf, EmptyObject, ArbitraryObject, ArbitraryFunction };
