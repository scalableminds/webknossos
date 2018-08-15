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
