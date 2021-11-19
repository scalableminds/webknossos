// @flow
import type { UpdateAction } from "oxalis/model/sagas/update_actions";
import { getUid } from "libs/uid_generator";
import Date from "libs/date";
import Deferred from "libs/deferred";

type TracingType = "skeleton" | "volume";

type PushSaveQueueTransaction = {
  type: "PUSH_SAVE_QUEUE_TRANSACTION",
  items: Array<UpdateAction>,
  tracingType: TracingType,
  tracingId: string,
  transactionId: string,
};
type SaveNowAction = { type: "SAVE_NOW" };
type ShiftSaveQueueAction = {
  type: "SHIFT_SAVE_QUEUE",
  count: number,
  tracingType: TracingType,
  tracingId: string,
};
type DiscardSaveQueuesAction = { type: "DISCARD_SAVE_QUEUES" };
type SetSaveBusyAction = { type: "SET_SAVE_BUSY", isBusy: boolean, tracingType: TracingType };
type SetLastSaveTimestampAction = {
  type: "SET_LAST_SAVE_TIMESTAMP",
  timestamp: number,
  tracingType: TracingType,
  tracingId: string,
};
export type SetVersionNumberAction = {
  type: "SET_VERSION_NUMBER",
  version: number,
  tracingType: TracingType,
  tracingId: string,
};
export type UndoAction = { type: "UNDO", callback?: () => void };
export type RedoAction = { type: "REDO", callback?: () => void };
type DisableSavingAction = { type: "DISABLE_SAVING" };
export type SaveAction =
  | PushSaveQueueTransaction
  | SaveNowAction
  | ShiftSaveQueueAction
  | DiscardSaveQueuesAction
  | SetSaveBusyAction
  | SetLastSaveTimestampAction
  | SetVersionNumberAction
  | UndoAction
  | RedoAction
  | DisableSavingAction;

export const pushSaveQueueTransaction = (
  items: Array<UpdateAction>,
  tracingType: TracingType,
  tracingId: string,
  transactionId: string = getUid(),
): PushSaveQueueTransaction => ({
  type: "PUSH_SAVE_QUEUE_TRANSACTION",
  items,
  tracingType,
  tracingId,
  transactionId,
});

export const saveNowAction = (): SaveNowAction => ({
  type: "SAVE_NOW",
});

export const shiftSaveQueueAction = (
  count: number,
  tracingType: TracingType,
  tracingId: string,
): ShiftSaveQueueAction => ({
  type: "SHIFT_SAVE_QUEUE",
  count,
  tracingType,
  tracingId,
});

export const discardSaveQueuesAction = (): DiscardSaveQueuesAction => ({
  type: "DISCARD_SAVE_QUEUES",
});

export const setSaveBusyAction = (
  isBusy: boolean,
  tracingType: TracingType,
): SetSaveBusyAction => ({
  type: "SET_SAVE_BUSY",
  isBusy,
  tracingType,
});

export const setLastSaveTimestampAction = (
  tracingType: TracingType,
  tracingId: string,
): SetLastSaveTimestampAction => ({
  type: "SET_LAST_SAVE_TIMESTAMP",
  timestamp: Date.now(),
  tracingType,
  tracingId,
});

export const setVersionNumberAction = (
  version: number,
  tracingType: TracingType,
  tracingId: string,
): SetVersionNumberAction => ({
  type: "SET_VERSION_NUMBER",
  version,
  tracingType,
  tracingId,
});

export const undoAction = (callback?: () => void): UndoAction => ({
  type: "UNDO",
  callback,
});

export const redoAction = (callback?: () => void): RedoAction => ({
  type: "REDO",
  callback,
});

export const disableSavingAction = (): DisableSavingAction => ({
  type: "DISABLE_SAVING",
});

// Unfortunately, using type Dispatch produces countless Flow errors.
export const dispatchUndoAsync = async (dispatch: any => any): Promise<void> => {
  const readyDeferred = new Deferred();
  const action = undoAction(() => readyDeferred.resolve());
  dispatch(action);
  await readyDeferred.promise();
};

// Unfortunately, using type Dispatch produces countless Flow errors.
export const dispatchRedoAsync = async (dispatch: any => any): Promise<void> => {
  const readyDeferred = new Deferred();
  const action = redoAction(() => readyDeferred.resolve());
  dispatch(action);
  await readyDeferred.promise();
};
