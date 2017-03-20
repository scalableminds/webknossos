declare module "seamless-immutable" {
  declare type Immutable<T: Object | Array<*>> = T & {
    // Array methods
    flatMap(fn: Function): Array<any>;
    asObject(fn: Function): Object;
    asMutable(): Array<any>;
    // Object methods
    merge(collection: Array<any> | Object, deep?: Object): Object;
    set(key: string, value: any): Object;
    setIn(keyPath: Array<string>, value: any): Object;
    update(key: string, fn: Function): Object;
    updateIn(keyPath: Array<string>, fn: Function): Object;
    without(fn: Function): Object;
    without(keys: Array<string>): Object;
    without(...keys: Array<string>): Object;
    asMutable(): Array<any> | Object;
  };

  declare function from<T: Object | Array<*>> (spec: T): Immutable<T>;

  declare type Default<T> = {
    from: typeof from;
    isImmutable: (x: *) => boolean;
    (x: T): T;
  };

  declare module.exports: Default<*>;
}
