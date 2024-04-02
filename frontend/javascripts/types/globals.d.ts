declare global {
  interface Window {
    needsRerender: boolean;
  }
}

// https://stackoverflow.com/questions/49285864/is-there-a-valueof-similar-to-keyof-in-typescript
export type ValueOf<T> = T[keyof T];
export type EmptyObject = Record<string, never>;
export type ArbitraryObject = Record<string, any>;
export type ArbitraryFunction = (...args: Array<any>) => any;
export type Comparator<T> = (arg0: T, arg1: T) => -1 | 0 | 1;
export type ArrayElement<A> = A extends readonly (infer T)[] ? T : never;
export type NestedOmit<T, K extends PropertyKey> = {
  [P in keyof T as P extends K ? never : P]: NestedOmit<
    T[P],
    K extends `${Exclude<P, symbol>}.${infer R}` ? R : never
  >;
};
