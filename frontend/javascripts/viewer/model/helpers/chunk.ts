import _ from "lodash";

export function chunk2<T>(arr: Array<T>): Array<[T, T]> {
  return _.chunk(arr, 2) as Array<[T, T]>;
}

export function chunk3<T>(arr: Array<T>): Array<[T, T, T]> {
  return _.chunk(arr, 3) as Array<[T, T, T]>;
}
