import type { Dispatch } from "redux";
import type { UpdateAction } from "oxalis/model/sagas/update_actions";
import { getUid } from "libs/uid_generator";
import Date from "libs/date";
import Deferred from "libs/async/deferred";
export type SaveQueueType = "skeleton" | "volume" | "mapping";

export type PushSaveQueueTransaction = ReturnType<typeof pushSaveQueueTransaction>;
type SaveNowAction = ReturnType<typeof saveNowAction>;
export type ShiftSaveQueueAction = ReturnType<typeof shiftSaveQueueAction>;
type DiscardSaveQueuesAction = ReturnType<typeof discardSaveQueuesAction>;
export type SetSaveBusyAction = ReturnType<typeof setSaveBusyAction>;
export type SetLastSaveTimestampAction = ReturnType<typeof setLastSaveTimestampAction>;
export type SetVersionNumberAction = ReturnType<typeof setVersionNumberAction>;
export type UndoAction = ReturnType<typeof undoAction>;
export type RedoAction = ReturnType<typeof redoAction>;
type DisableSavingAction = ReturnType<typeof disableSavingAction>;

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
  tracingId: string,
  transactionId: string = getUid(),
) =>
  ({
    type: "PUSH_SAVE_QUEUE_TRANSACTION",
    items,
    transactionId,
    tracingId,
  }) as const;

export const saveNowAction = () =>
  ({
    type: "SAVE_NOW",
  }) as const;

export const shiftSaveQueueAction = (count: number) =>
  ({
    type: "SHIFT_SAVE_QUEUE",
    count,
  }) as const;

export const discardSaveQueuesAction = () =>
  ({
    type: "DISCARD_SAVE_QUEUES",
  }) as const;

export const setSaveBusyAction = (isBusy: boolean) =>
  ({
    type: "SET_SAVE_BUSY",
    isBusy,
  }) as const;

export const setLastSaveTimestampAction = () =>
  ({
    type: "SET_LAST_SAVE_TIMESTAMP",
    timestamp: Date.now(),
  }) as const;

export const setVersionNumberAction = (version: number) =>
  ({
    type: "SET_VERSION_NUMBER",
    version,
  }) as const;

export const undoAction = (callback?: () => void) =>
  ({
    type: "UNDO",
    callback,
  }) as const;

export const redoAction = (callback?: () => void) =>
  ({
    type: "REDO",
    callback,
  }) as const;

export const disableSavingAction = () =>
  ({
    type: "DISABLE_SAVING",
  }) as const;

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
