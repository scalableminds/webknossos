/* eslint-disable import/prefer-default-export */

/**
 * save_actions.js
 * @flow
 */
import Date from "libs/date";
import type { UpdateAction } from "oxalis/model/sagas/update_actions";

type TracingType = "skeleton" | "volume";

type PushSaveQueueActionType = {
  type: "PUSH_SAVE_QUEUE",
  items: Array<UpdateAction>,
  tracingType: TracingType,
};
type SaveNowActionType = { type: "SAVE_NOW" };
type ShiftSaveQueueActionType = {
  type: "SHIFT_SAVE_QUEUE",
  count: number,
  tracingType: TracingType,
};
type DiscardSaveQueuesActionType = { type: "DISCARD_SAVE_QUEUES" };
type SetSaveBusyActionType = { type: "SET_SAVE_BUSY", isBusy: boolean, tracingType: TracingType };
type SetLastSaveTimestampActionType = {
  type: "SET_LAST_SAVE_TIMESTAMP",
  timestamp: number,
  tracingType: TracingType,
};
type SetVersionNumberActionType = {
  type: "SET_VERSION_NUMBER",
  version: number,
  tracingType: TracingType,
};
type UndoActionType = { type: "UNDO" };
type RedoActionType = { type: "REDO" };
export type SaveActionType =
  | PushSaveQueueActionType
  | SaveNowActionType
  | ShiftSaveQueueActionType
  | DiscardSaveQueuesActionType
  | SetSaveBusyActionType
  | SetLastSaveTimestampActionType
  | SetVersionNumberActionType
  | UndoActionType
  | RedoActionType;

export const pushSaveQueueAction = (
  items: Array<UpdateAction>,
  tracingType: TracingType,
): PushSaveQueueActionType => ({
  type: "PUSH_SAVE_QUEUE",
  items,
  tracingType,
});

export const saveNowAction = (): SaveNowActionType => ({
  type: "SAVE_NOW",
});

export const shiftSaveQueueAction = (
  count: number,
  tracingType: TracingType,
): ShiftSaveQueueActionType => ({
  type: "SHIFT_SAVE_QUEUE",
  count,
  tracingType,
});

export const discardSaveQueuesAction = (): DiscardSaveQueuesActionType => ({
  type: "DISCARD_SAVE_QUEUES",
});

export const setSaveBusyAction = (
  isBusy: boolean,
  tracingType: TracingType,
): SetSaveBusyActionType => ({
  type: "SET_SAVE_BUSY",
  isBusy,
  tracingType,
});

export const setLastSaveTimestampAction = (
  timestamp: number = Date.now(),
  tracingType: TracingType,
): SetLastSaveTimestampActionType => ({
  type: "SET_LAST_SAVE_TIMESTAMP",
  timestamp,
  tracingType,
});

export const setVersionNumberAction = (
  version: number,
  tracingType: TracingType,
): SetVersionNumberActionType => ({
  type: "SET_VERSION_NUMBER",
  version,
  tracingType,
});

export const undoAction = (): UndoActionType => ({
  type: "UNDO",
});

export const redoAction = (): RedoActionType => ({
  type: "REDO",
});
