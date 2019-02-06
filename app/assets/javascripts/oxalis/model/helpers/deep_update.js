// @noflow
// Do not add a flow header to this file, typings exist in deep_update.js.flow
// This module provides multiple methods to update deeply nested fields in StoreState.
// In contrast to immutability-helper, flow will be able to completely type such calls.

// Example:
// updateKey2(state, "viewModeData", "plane", { activeViewport: "PLANE_XY" });
// The last parameter can hold multiple key-value pairs. Only the used keys will be updated.

export function updateKey(state, key, shape) {
  return {
    ...state,
    [key]: {
      ...state[key],
      ...shape,
    },
  };
}

export function updateKey2(state, key1, key2, shape) {
  return {
    ...state,
    [key1]: {
      ...state[key1],
      [key2]: {
        ...state[key1][key2],
        ...shape,
      },
    },
  };
}

export function updateKey3(state, key1, key2, key3, shape) {
  return {
    ...state,
    [key1]: {
      ...state[key1],
      [key2]: {
        ...state[key1][key2],
        [key3]: {
          ...state[key1][key2][key3],
          ...shape,
        },
      },
    },
  };
}

export function updateKey4(state, key1, key2, key3, key4, shape) {
  return {
    ...state,
    [key1]: {
      ...state[key1],
      [key2]: {
        ...state[key1][key2],
        [key3]: {
          ...state[key1][key2][key3],
          [key4]: {
            ...state[key1][key2][key3][key4],
            ...shape,
          },
        },
      },
    },
  };
}
