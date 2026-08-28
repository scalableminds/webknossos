import chunk from "lodash-es/chunk";

export function chunk2<T>(arr: Array<T>): Array<[T, T]> {
  return chunk(arr, 2) as Array<[T, T]>;
}

export function chunk3<T>(arr: Array<T>): Array<[T, T, T]> {
  return chunk(arr, 3) as Array<[T, T, T]>;
}
