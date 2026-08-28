// Adapted from https://github.com/DefinitelyTyped/DefinitelyTyped
// License: MIT
// Source: https://github.com/DefinitelyTyped/DefinitelyTyped/blob/master/types/prop-types/index.d.ts

declare module "@scalableminds/prop-types" {
    
  export type ReactComponentLike =
    | string
    | ((props: any, context?: any) => any)
    | (new (
        props: any,
        context?: any,
      ) => any);

  export interface ReactElementLike {
    type: ReactComponentLike;
    props: any;
    key: string | null;
  }

  export interface ReactNodeArray extends Iterable<ReactNodeLike> {}

  export type ReactNodeLike =
    | ReactElementLike
    | ReactNodeArray
    | string
    | number
    | boolean
    | null
    | undefined;

  export const nominalTypeHack: unique symbol;

  export type IsOptional<T> = undefined extends T ? true : false;

  export type RequiredKeys<V> = {
    [K in keyof V]-?: Exclude<V[K], undefined> extends Validator<infer T>
      ? IsOptional<T> extends true
        ? never
        : K
      : never;
  }[keyof V];
  export type OptionalKeys<V> = Exclude<keyof V, RequiredKeys<V>>;
  export type InferPropsInner<V> = { [K in keyof V]-?: InferType<V[K]> };

  export interface Validator<T> {
    (
      props: { [key: string]: any },
      propName: string,
      componentName: string,
      location: string,
      propFullName: string,
    ): Error | null;
    [nominalTypeHack]?:
      | {
          type: T;
        }
      | undefined;
  }

  export interface Requireable<T> extends Validator<T | undefined | null> {
    isRequired: Validator<NonNullable<T>>;
  }

  export type ValidationMap<T> = { [K in keyof T]?: Validator<T[K]> };

  /**
   * Like {@link ValidationMap} but treats `undefined`, `null` and optional properties the same.
   * This type is only added as a migration path in React 19 where this type was removed from React.
   * Runtime and compile time types would mismatch since you could see `undefined` at runtime when your types don't expect this type.
   */
  export type WeakValidationMap<T> = {
    [K in keyof T]?: null extends T[K]
      ? Validator<T[K] | null | undefined>
      : undefined extends T[K]
        ? Validator<T[K] | null | undefined>
        : Validator<T[K]>;
  };

  export type InferType<V> = V extends Validator<infer T> ? T : any;
  export type InferProps<V> = InferPropsInner<Pick<V, RequiredKeys<V>>> &
    Partial<InferPropsInner<Pick<V, OptionalKeys<V>>>>;

  const any: Requireable<any>;
  const array: Requireable<any[]>;
  const bool: Requireable<boolean>;
  const func: Requireable<(...args: any[]) => any>;
  const number: Requireable<number>;
  const object: Requireable<object>;
  const string: Requireable<string>;
  const node: Requireable<ReactNodeLike>;
  const element: Requireable<ReactElementLike>;
  const symbol: Requireable<symbol>;
  const elementType: Requireable<ReactComponentLike>;
  function instanceOf<T>(expectedClass: new (...args: any[]) => T): Requireable<T>;
  function oneOf<T>(types: readonly T[]): Requireable<T>;
  function oneOfType<T extends Validator<any>>(types: T[]): Requireable<NonNullable<InferType<T>>>;
  function arrayOf<T>(type: Validator<T>): Requireable<T[]>;
  function objectOf<T>(type: Validator<T>): Requireable<{ [K in keyof any]: T }>;
  function shape<P extends ValidationMap<any>>(type: P): Requireable<InferProps<P>>;
  function exact<P extends ValidationMap<any>>(type: P): Requireable<Required<InferProps<P>>>;

  /**
   * Assert that the values match with the type specs.
   * Error messages are memorized and will only be shown once.
   *
   * @param typeSpecs Map of name to a ReactPropType
   * @param values Runtime values that need to be type-checked
   * @param location e.g. "prop", "context", "child context"
   * @param componentName Name of the component for error messages
   * @param getStack Returns the component stack
   */
  export function checkPropTypes(
    typeSpecs: any,
    values: any,
    location: string,
    componentName: string,
    getStack?: () => any,
  ): void;

  /**
   * Only available if NODE_ENV=production
   */
  export function resetWarningCache(): void;

  export const PropTypes = {
    any,
    array,
    bool,
    func,
    number,
    object,
    string,
    node,
    element,
    symbol,
    elementType,
    instanceOf,
    oneOf,
    oneOfType,
    arrayOf,
    objectOf,
    shape,
    exact,
    checkPropTypes,
    resetWarningCache,
  };
}
