// @flow
import _ from "lodash";

export function chunk2<T>(arr: Array<T>): Array<[T, T]> {
  // $FlowFixMe
  return _.chunk(arr, 2);
}

export function chunk3<T>(arr: Array<T>): Array<[T, T, T]> {
  // $FlowFixMe
  return _.chunk(arr, 3);
}
