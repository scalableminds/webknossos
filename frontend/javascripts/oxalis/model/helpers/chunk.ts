import _ from "lodash";
export function chunk2<T>(arr: Array<T>): Array<[T, T]> {
  // $FlowFixMe[invalid-tuple-arity]
  // $FlowFixMe[incompatible-return]
  // @ts-expect-error ts-migrate(2322) FIXME: Type 'T[][]' is not assignable to type '[T, T][]'.
  return _.chunk(arr, 2);
}
export function chunk3<T>(arr: Array<T>): Array<[T, T, T]> {
  // $FlowFixMe[invalid-tuple-arity]
  // $FlowFixMe[incompatible-return]
  // @ts-expect-error ts-migrate(2322) FIXME: Type 'T[][]' is not assignable to type '[T, T, T][... Remove this comment to see the full error message
  return _.chunk(arr, 3);
}
