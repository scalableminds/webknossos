// The save saga uses a retry mechanism which is based
// on exponential back-off.
export const PUSH_THROTTLE_TIME = 30000; // 30s

export const SAVE_RETRY_WAITING_TIME = 2000;
export const MAX_SAVE_RETRY_WAITING_TIME = 300000; // 5m

export const UNDO_HISTORY_SIZE = 20;
// Other sagas which simply use the redux-saga's default `retry`,
// need a more simplistic configuration.
export const SETTINGS_RETRY_DELAY = 15 * 1000;
export const SETTINGS_MAX_RETRY_COUNT = 20; // 20 * 15s == 5m

export const MAXIMUM_ACTION_COUNT_PER_BATCH = 1000;

// See #8274.
// This constant used to be the following:
// export const MAXIMUM_ACTION_COUNT_PER_SAVE = {
//   skeleton: 15000,
//   volume: 3000,
//   mapping: Number.POSITIVE_INFINITY, // The back-end does not accept transactions for mappings.
// } as const;
export const MAXIMUM_ACTION_COUNT_PER_SAVE = 3000;
