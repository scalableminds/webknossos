/*
 * Typescript utility types
 */


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
export type Writeable<T> = {
  -readonly [P in keyof T]: T[P];
};

export function ensureExactKeys<T>() {
  /*
   * Can be used to have a hardcoded list of property names of a type T,
   * while ensuring via TypeScript that the list is correct & complete.
   */
  return <K extends readonly (keyof T)[]>(
    keys: K &
      // no extra keys
      (Exclude<K[number], keyof T> extends never
        ? unknown
        : ["Extra keys", Exclude<K[number], keyof T>]) &
      // no missing keys
      (Exclude<keyof T, K[number]> extends never
        ? unknown
        : ["Missing keys", Exclude<keyof T, K[number]>]),
  ) => keys;
}
