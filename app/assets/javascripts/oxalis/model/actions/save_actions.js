/* eslint-disable import/prefer-default-export */

/**
 * save_actions.js
 * @flow
 */
import type { UpdateAction } from "oxalis/model/sagas/update_actions";

type PushSaveQueueActionType = { type: "PUSH_SAVE_QUEUE", items: Array<UpdateAction>, pushNow: boolean };
type SaveNowActionType = { type: "SAVE_NOW" };
type ShiftSaveQueueActionType = { type: "SHIFT_SAVE_QUEUE", count: number };
type SetSaveBusyActionType = { type: "SET_SAVE_BUSY", isBusy: boolean };
type SetLastSaveTimestampActionType = { type: "SET_LAST_SAVE_TIMESTAMP", timestamp: number };
type SetVersionNumberActionType = {type: "SET_VERSION_NUMBER", version: number};
type UndoActionType = {type: "UNDO"};
export type SaveActionType =
  PushSaveQueueActionType |
  SaveNowActionType |
  ShiftSaveQueueActionType |
  SetSaveBusyActionType |
  SetLastSaveTimestampActionType |
  SetVersionNumberActionType |
  UndoActionType;

export const pushSaveQueueAction = (items: Array<UpdateAction>, pushNow?: boolean = false): PushSaveQueueActionType => ({
  type: "PUSH_SAVE_QUEUE",
  items,
  pushNow,
});

export const saveNowAction = (): SaveNowActionType => ({
  type: "SAVE_NOW",
});

export const shiftSaveQueueAction = (count: number): ShiftSaveQueueActionType => ({
  type: "SHIFT_SAVE_QUEUE",
  count,
});

export const setSaveBusyAction = (isBusy: boolean): SetSaveBusyActionType => ({
  type: "SET_SAVE_BUSY",
  isBusy,
});

export const setLastSaveTimestampAction = (timestamp: number = Date.now()): SetLastSaveTimestampActionType => ({
  type: "SET_LAST_SAVE_TIMESTAMP",
  timestamp,
});

export const setVersionNumberAction = (version: number): SetVersionNumberActionType => ({
  type: "SET_VERSION_NUMBER",
  version,
});

export const undoAction = (): UndoActionType => ({
  type: "UNDO",
});
