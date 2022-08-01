import type { Dispatch } from "redux";
import type { UpdateAction } from "oxalis/model/sagas/update_actions";
import { getUid } from "libs/uid_generator";
import Date from "libs/date";
import Deferred from "libs/deferred";
export type SaveQueueType = "skeleton" | "volume" | "mapping";
export type PushSaveQueueTransaction = {
  type: "PUSH_SAVE_QUEUE_TRANSACTION";
  items: Array<UpdateAction>;
  saveQueueType: SaveQueueType;
  tracingId: string;
  transactionId: string;
};
type SaveNowAction = {
  type: "SAVE_NOW";
};
export type ShiftSaveQueueAction = {
  type: "SHIFT_SAVE_QUEUE";
  count: number;
  saveQueueType: SaveQueueType;
  tracingId: string;
};
type DiscardSaveQueuesAction = {
  type: "DISCARD_SAVE_QUEUES";
};
type SetSaveBusyAction = {
  type: "SET_SAVE_BUSY";
  isBusy: boolean;
  saveQueueType: SaveQueueType;
};
export type SetLastSaveTimestampAction = {
  type: "SET_LAST_SAVE_TIMESTAMP";
  timestamp: number;
  saveQueueType: SaveQueueType;
  tracingId: string;
};
export type SetVersionNumberAction = {
  type: "SET_VERSION_NUMBER";
  version: number;
  saveQueueType: SaveQueueType;
  tracingId: string;
};
export type UndoAction = {
  type: "UNDO";
  callback?: () => void;
};
export type RedoAction = {
  type: "REDO";
  callback?: () => void;
};
type DisableSavingAction = {
  type: "DISABLE_SAVING";
};
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
  saveQueueType: SaveQueueType,
  tracingId: string,
  transactionId: string = getUid(),
): PushSaveQueueTransaction => ({
  type: "PUSH_SAVE_QUEUE_TRANSACTION",
  items,
  saveQueueType,
  tracingId,
  transactionId,
});
export const saveNowAction = (): SaveNowAction => ({
  type: "SAVE_NOW",
});
export const shiftSaveQueueAction = (
  count: number,
  saveQueueType: SaveQueueType,
  tracingId: string,
): ShiftSaveQueueAction => ({
  type: "SHIFT_SAVE_QUEUE",
  count,
  saveQueueType,
  tracingId,
});
export const discardSaveQueuesAction = (): DiscardSaveQueuesAction => ({
  type: "DISCARD_SAVE_QUEUES",
});
export const setSaveBusyAction = (
  isBusy: boolean,
  saveQueueType: SaveQueueType,
): SetSaveBusyAction => ({
  type: "SET_SAVE_BUSY",
  isBusy,
  saveQueueType,
});
export const setLastSaveTimestampAction = (
  saveQueueType: SaveQueueType,
  tracingId: string,
): SetLastSaveTimestampAction => ({
  type: "SET_LAST_SAVE_TIMESTAMP",
  timestamp: Date.now(),
  saveQueueType,
  tracingId,
});
export const setVersionNumberAction = (
  version: number,
  saveQueueType: SaveQueueType,
  tracingId: string,
): SetVersionNumberAction => ({
  type: "SET_VERSION_NUMBER",
  version,
  saveQueueType,
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
export const dispatchUndoAsync = async (dispatch: Dispatch<any>): Promise<void> => {
  const readyDeferred = new Deferred();
  const action = undoAction(() => readyDeferred.resolve(null));
  dispatch(action);
  await readyDeferred.promise();
};
export const dispatchRedoAsync = async (dispatch: Dispatch<any>): Promise<void> => {
  const readyDeferred = new Deferred();
  const action = redoAction(() => readyDeferred.resolve(null));
  dispatch(action);
  await readyDeferred.promise();
};
