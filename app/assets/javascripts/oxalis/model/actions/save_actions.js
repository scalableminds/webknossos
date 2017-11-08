/* eslint-disable import/prefer-default-export */

/**
 * save_actions.js
 * @flow
 */
import Date from "libs/date";
import type { UpdateAction } from "oxalis/model/sagas/update_actions";

type PushSaveQueueActionType = {
  type: "PUSH_SAVE_QUEUE",
  items: Array<UpdateAction>,
  pushNow: boolean,
};
type SaveNowActionType = { type: "SAVE_NOW" };
type ShiftSaveQueueActionType = { type: "SHIFT_SAVE_QUEUE", count: number };
type DiscardSaveQueueActionType = { type: "DISCARD_SAVE_QUEUE" };
type SetSaveBusyActionType = { type: "SET_SAVE_BUSY", isBusy: boolean };
type SetLastSaveTimestampActionType = { type: "SET_LAST_SAVE_TIMESTAMP", timestamp: number };
type SetVersionNumberActionType = { type: "SET_VERSION_NUMBER", version: number };
type UndoActionType = { type: "UNDO" };
type RedoActionType = { type: "REDO" };
export type SaveActionType =
  | PushSaveQueueActionType
  | SaveNowActionType
  | ShiftSaveQueueActionType
  | DiscardSaveQueueActionType
  | SetSaveBusyActionType
  | SetLastSaveTimestampActionType
  | SetVersionNumberActionType
  | UndoActionType
  | RedoActionType;

export const pushSaveQueueAction = (
  items: Array<UpdateAction>,
  pushNow?: boolean = false,
): PushSaveQueueActionType => ({
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

export const discardSaveQueueAction = (): DiscardSaveQueueActionType => ({
  type: "DISCARD_SAVE_QUEUE",
});

export const setSaveBusyAction = (isBusy: boolean): SetSaveBusyActionType => ({
  type: "SET_SAVE_BUSY",
  isBusy,
});

export const setLastSaveTimestampAction = (
  timestamp: number = Date.now(),
): SetLastSaveTimestampActionType => ({
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

export const redoAction = (): RedoActionType => ({
  type: "REDO",
});
