import _ from "lodash";

/*
  Wraps a given function so that it returns the same instance on consecutive
  calls if the new and old return value are equal (given an equality function).

  Motivation:
  Most of our selectors are memoized which ensures that passing the same input,
  produces the same outputs. As a result, instances are shared and shallow
  comparisons minimize potential re-renders.
  However, some selectors depend on the entire store state since they derive
  complex computations. Every small change to the store, will produce a new
  output even if it's equal to the last output.
  So, instead of carefully decomposing all selectors to ensure maximum
  instance-reusages, the `reuseInstanceOnEquality` can be used.

  As a rule of thumb, this wrapper should be used for selectors which need
  the entire store state.

  Note that this function isn't of any use if the return type of the passed
  function is a primitive value.
 */
export function reuseInstanceOnEquality<R, F extends (...args: Array<any>) => R>(
  fn: F,
  equalityFunction: (arg0: R, arg1: R) => boolean = _.isEqual,
): F {
  let lastResult: R;
  // @ts-expect-error ts-migrate(2322) FIXME: Type '(...args: Array<any>) => R' is not assignabl... Remove this comment to see the full error message
  return (...args: Array<any>): R => {
    const result = fn(...args);

    if (result === lastResult || equalityFunction(result, lastResult)) {
      return lastResult;
    } else {
      lastResult = result;
      return lastResult;
    }
  };
}
export default {};
