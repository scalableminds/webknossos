/* eslint-disable import/prefer-default-export */

/**
 * save_actions.js
 * @flow
 */
import type { UpdateAction } from "oxalis/model/sagas/update_actions";
import Date from "libs/date";

type Tracing = "skeleton" | "volume";

type PushSaveQueueAction = {
  type: "PUSH_SAVE_QUEUE",
  items: Array<UpdateAction>,
  tracingType: Tracing,
};
type SaveNowAction = { type: "SAVE_NOW" };
type ShiftSaveQueueAction = {
  type: "SHIFT_SAVE_QUEUE",
  count: number,
  tracingType: Tracing,
};
type DiscardSaveQueuesAction = { type: "DISCARD_SAVE_QUEUES" };
type SetSaveBusyAction = { type: "SET_SAVE_BUSY", isBusy: boolean, tracingType: Tracing };
type SetLastSaveTimestampAction = {
  type: "SET_LAST_SAVE_TIMESTAMP",
  timestamp: number,
  tracingType: Tracing,
};
type SetVersionNumberAction = {
  type: "SET_VERSION_NUMBER",
  version: number,
  tracingType: Tracing,
};
type UndoAction = { type: "UNDO" };
type RedoAction = { type: "REDO" };
export type SaveAction =
  | PushSaveQueueAction
  | SaveNowAction
  | ShiftSaveQueueAction
  | DiscardSaveQueuesAction
  | SetSaveBusyAction
  | SetLastSaveTimestampAction
  | SetVersionNumberAction
  | UndoAction
  | RedoAction;

export const pushSaveQueueAction = (
  items: Array<UpdateAction>,
  tracingType: Tracing,
): PushSaveQueueAction => ({
  type: "PUSH_SAVE_QUEUE",
  items,
  tracingType,
});

export const saveNowAction = (): SaveNowAction => ({
  type: "SAVE_NOW",
});

export const shiftSaveQueueAction = (
  count: number,
  tracingType: Tracing,
): ShiftSaveQueueAction => ({
  type: "SHIFT_SAVE_QUEUE",
  count,
  tracingType,
});

export const discardSaveQueuesAction = (): DiscardSaveQueuesAction => ({
  type: "DISCARD_SAVE_QUEUES",
});

export const setSaveBusyAction = (isBusy: boolean, tracingType: Tracing): SetSaveBusyAction => ({
  type: "SET_SAVE_BUSY",
  isBusy,
  tracingType,
});

export const setLastSaveTimestampAction = (
  timestamp: number = Date.now(),
  tracingType: Tracing,
): SetLastSaveTimestampAction => ({
  type: "SET_LAST_SAVE_TIMESTAMP",
  timestamp,
  tracingType,
});

export const setVersionNumberAction = (
  version: number,
  tracingType: Tracing,
): SetVersionNumberAction => ({
  type: "SET_VERSION_NUMBER",
  version,
  tracingType,
});

export const undoAction = (): UndoAction => ({
  type: "UNDO",
});

export const redoAction = (): RedoAction => ({
  type: "REDO",
});
