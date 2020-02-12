// @flow

export const PUSH_THROTTLE_TIME = 100; // 30s
export const SAVE_RETRY_WAITING_TIME = 2000;
export const MAX_SAVE_RETRY_WAITING_TIME = 300000; // 5m
export const UNDO_HISTORY_SIZE = 20;

export const maximumActionCountPerBatch = 5000;
export const maximumActionCountPerSave = 15000;
