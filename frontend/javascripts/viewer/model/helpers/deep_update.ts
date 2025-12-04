// This module provides multiple methods to update deeply nested fields in StoreState.
// When we still used flow, this module was superior to immutability-helper regarding
// type safety. However, by now immutability-helper is also fine to use.
// Example:
// updateKey2(state, "viewModeData", "plane", { activeViewport: "PLANE_XY" });
// The last parameter can hold multiple key-value pairs. Only the used keys will be updated.

import type { WebknossosState } from "viewer/store";

export function updateKey<Key1 extends keyof WebknossosState>(
  state: WebknossosState,
  key: keyof WebknossosState,
  shape: Partial<WebknossosState[Key1]>,
): WebknossosState {
  return { ...state, [key]: { ...state[key], ...shape } };
}

export function updateKey2<
  TKey1 extends keyof WebknossosState & string,
  TKey2 extends keyof WebknossosState[TKey1] & string,
>(
  state: WebknossosState,
  key1: TKey1,
  key2: TKey2,
  shape: Partial<WebknossosState[TKey1][TKey2]>,
): WebknossosState {
  // @ts-expect-error
  return { ...state, [key1]: { ...state[key1], [key2]: { ...state[key1][key2], ...shape } } };
}
export function updateKey3<
  TKey1 extends keyof WebknossosState & string,
  TKey2 extends keyof WebknossosState[TKey1] & string,
  TKey3 extends keyof WebknossosState[TKey1][TKey2] & string,
>(
  state: WebknossosState,
  key1: TKey1,
  key2: TKey2,
  key3: TKey3,
  shape: Partial<WebknossosState[TKey1][TKey2][TKey3]>,
): WebknossosState {
  return {
    ...state,
    [key1]: {
      ...state[key1],
      // @ts-expect-error
      [key2]: { ...state[key1][key2], [key3]: { ...state[key1][key2][key3], ...shape } },
    },
  };
}
export function updateKey4<
  TKey1 extends keyof WebknossosState & string,
  TKey2 extends keyof WebknossosState[TKey1] & string,
  TKey3 extends keyof WebknossosState[TKey1][TKey2] & string,
  TKey4 extends keyof WebknossosState[TKey1][TKey2][TKey3] & (string | number),
>(
  state: WebknossosState,
  key1: TKey1,
  key2: TKey2,
  key3: TKey3,
  key4: TKey4,
  shape: Partial<WebknossosState[TKey1][TKey2][TKey3][TKey4]>,
): WebknossosState {
  return {
    ...state,
    [key1]: {
      ...state[key1],
      [key2]: {
        // @ts-expect-error
        ...state[key1][key2],
        [key3]: {
          // @ts-expect-error
          ...state[key1][key2][key3],
          // @ts-expect-error
          [key4]: { ...state[key1][key2][key3][key4], ...shape },
        },
      },
    },
  };
}
