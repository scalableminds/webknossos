declare module "data.maybe" {
  declare class Functor<A> {
    map<B>(f: (a: A) => B): Functor<B>;
  }

  declare class Apply<A> extends Functor<A> {
    ap<B>(fab: Apply<(a: A) => B>): Apply<B>;
  }

  declare class Applicative<A> extends Apply<A> {
    of<B>(b: B): Applicative<B>;
  }

  declare class Chain<A> extends Apply<A> {
    chain<B>(f: (a: A) => Chain<B>): Chain<B>;
  }

  declare interface Monad<A> extends Applicative<A>, Chain<A> {}

  declare class Validation<F, S> extends Applicative<S> {}

  declare class IMaybe<T> {
    isNothing: boolean;
    isJust: boolean;
    isEqual(om: IMaybe<T>): boolean;
    toString(): string;
    toJSON(): Record<string, any>;
    get(): T;
    getOrElse<S>(defaultValue: S | T): S | T;
    map<B>(f: (v: T) => B): IMaybe<B>;
    ap<B>(fb: IMaybe<B> | Applicative<B>): IMaybe<B>;
    chain<B>(f: (v: T) => IMaybe<B>): IMaybe<B>;
    orElse<T>(f: () => IMaybe<T>): IMaybe<T>;
    cata<B>(patterns: { Nothing: () => B; Just: (v: T) => B }): B;
    static Nothing<T>(): IMaybe<T>;
    static Just<T>(value: T): IMaybe<T>;
    static of<T>(value: T): IMaybe<T>;
    static fromNullable(value: T | null | undefined): IMaybe<T>;
  }

  export default IMaybe;
}
