import Deferred from "libs/async/deferred";
import Date from "libs/date";
import { getUid } from "libs/uid_generator";
import type { Dispatch } from "redux";
import type { APIUserCompact } from "types/api_types";
import type {
  UpdateAction,
  UpdateActionWithIsolationRequirement,
  UpdateActionWithoutIsolationRequirement,
} from "viewer/model/sagas/volume/update_actions";
import type { SaveQueueEntry, StoreAnnotation } from "viewer/store";
export type SaveQueueType = "skeleton" | "volume" | "mapping";
import { areSetsEqual } from "libs/utils";
import compact from "lodash/compact";

export type PushSaveQueueTransaction = {
  type: "PUSH_SAVE_QUEUE_TRANSACTION";
  items: UpdateAction[];
  transactionId: string;
};
export type NotifyAboutUpdatedBucketsAction = ReturnType<typeof notifyAboutUpdatedBucketsAction>;
export type SaveNowAction = ReturnType<typeof saveNowAction>;
export type ShiftSaveQueueAction = ReturnType<typeof shiftSaveQueueAction>;
type DiscardSaveQueueAction = ReturnType<typeof discardSaveQueueAction>;
export type SetSaveBusyAction = ReturnType<typeof setSaveBusyAction>;
export type SetLastSaveTimestampAction = ReturnType<typeof setLastSaveTimestampAction>;
export type SetVersionNumberAction = ReturnType<typeof setVersionNumberAction>;
export type UndoAction = ReturnType<typeof undoAction>;
export type RedoAction = ReturnType<typeof redoAction>;
type DisableSavingAction = ReturnType<typeof disableSavingAction>;
export type EnsureTracingsWereDiffedToSaveQueueAction = ReturnType<
  typeof ensureTracingsWereDiffedToSaveQueueAction
>;
export type EnsureHasAnnotationMutexAction = ReturnType<typeof ensureHasAnnotationMutexAction>;
export type EnsureHasNewestVersionAction = ReturnType<typeof ensureHasNewestVersionAction>;
export type DoneSavingAction = ReturnType<typeof doneSavingAction>;
export type SetIsMutexAcquiredAction = ReturnType<typeof setIsMutexAcquiredAction>;
export type SetUserHoldingMutexAction = ReturnType<typeof setUserHoldingMutexAction>;
export type PrepareRebaseAction = ReturnType<typeof prepareRebaseAction>;
export type FinishedRebaseAction = ReturnType<typeof finishedRebaseAction>;
export type UpdateMappingRebaseInformationAction = ReturnType<
  typeof snapshotMappingDataForNextRebaseAction
>;
export type FinishedApplyingMissingUpdatesAction = ReturnType<
  typeof finishedApplyingMissingUpdatesAction
>;
export type ReplaceSaveQueueAction = ReturnType<typeof replaceSaveQueueAction>;

export type SaveAction =
  | PushSaveQueueTransaction
  | SaveNowAction
  | ShiftSaveQueueAction
  | DiscardSaveQueueAction
  | NotifyAboutUpdatedBucketsAction
  | SetSaveBusyAction
  | SetLastSaveTimestampAction
  | SetVersionNumberAction
  | UndoAction
  | RedoAction
  | DisableSavingAction
  | EnsureTracingsWereDiffedToSaveQueueAction
  | EnsureHasAnnotationMutexAction
  | EnsureHasNewestVersionAction
  | DoneSavingAction
  | SetIsMutexAcquiredAction
  | SetUserHoldingMutexAction
  | PrepareRebaseAction
  | FinishedRebaseAction
  | UpdateMappingRebaseInformationAction
  | FinishedApplyingMissingUpdatesAction
  | ReplaceSaveQueueAction;

// The following actions can be used to "push" update actions into the local save queue
// of the Store.
// The action creators pushSaveQueueTransaction and pushSaveQueueTransactionIsolated
// are typed so that update actions that need isolation are isolated in a group each.
// From this point on, we can assume that the groups fulfill the isolation requirement.
export const pushSaveQueueTransaction = (
  items: Array<UpdateActionWithoutIsolationRequirement>,
): PushSaveQueueTransaction =>
  ({
    type: "PUSH_SAVE_QUEUE_TRANSACTION",
    items,
    transactionId: getUid(),
  }) as const;

export const pushSaveQueueTransactionIsolated = (
  item: UpdateActionWithIsolationRequirement,
): PushSaveQueueTransaction =>
  ({
    type: "PUSH_SAVE_QUEUE_TRANSACTION",
    items: [item],
    transactionId: getUid(),
  }) as const;

export const notifyAboutUpdatedBucketsAction = (count: number) =>
  ({ type: "NOTIFY_ABOUT_UPDATED_BUCKETS", count }) as const;

export const saveNowAction = () =>
  ({
    type: "SAVE_NOW",
  }) as const;

export const shiftSaveQueueAction = (count: number) =>
  ({
    type: "SHIFT_SAVE_QUEUE",
    count,
  }) as const;

export const discardSaveQueueAction = () =>
  ({
    type: "DISCARD_SAVE_QUEUE",
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

// See Model.ensureSavedState for an explanation of this action.
export const ensureTracingsWereDiffedToSaveQueueAction = (
  callback: (tracingId: string) => void,
) => {
  return {
    type: "ENSURE_TRACINGS_WERE_DIFFED_TO_SAVE_QUEUE",
    callback,
  } as const;
};

export const dispatchEnsureTracingsWereDiffedToSaveQueueAction = async (
  dispatch: Dispatch<any>,
  annotation: StoreAnnotation,
): Promise<void> => {
  // All skeleton and volume tracings should respond to the dispatched action.
  const tracingIds = new Set(
    compact([annotation.skeleton?.tracingId, ...annotation.volumes.map((t) => t.tracingId)]),
  );
  const reportedTracingIds = new Set();
  const deferred = new Deferred();
  function callback(tracingId: string) {
    reportedTracingIds.add(tracingId);
    if (areSetsEqual(tracingIds, reportedTracingIds)) {
      deferred.resolve(null);
    }
  }

  if (tracingIds.size > 0) {
    dispatch(ensureTracingsWereDiffedToSaveQueueAction(callback));
    await deferred.promise();
  }
};

export const ensureHasAnnotationMutexAction = (callback: () => void) =>
  ({
    type: "ENSURE_HAS_ANNOTATION_MUTEX",
    callback,
  }) as const;

export const dispatchEnsureHasAnnotationMutexAsync = async (
  dispatch: Dispatch<any>,
): Promise<void> => {
  const readyDeferred = new Deferred();
  const action = ensureHasAnnotationMutexAction(() => readyDeferred.resolve(null));
  dispatch(action);
  await readyDeferred.promise();
};

export const ensureHasNewestVersionAction = (callback: () => void) =>
  ({
    type: "ENSURE_HAS_NEWEST_VERSION",
    callback,
  }) as const;

export const dispatchEnsureHasNewestVersionAsync = async (
  dispatch: Dispatch<any>,
): Promise<void> => {
  const readyDeferred = new Deferred();
  const action = ensureHasNewestVersionAction(() => readyDeferred.resolve(null));
  dispatch(action);
  await readyDeferred.promise();
};

export const doneSavingAction = () =>
  ({
    type: "DONE_SAVING",
  }) as const;

export const setIsMutexAcquiredAction = (isMutexAcquired: boolean) =>
  ({
    type: "SET_IS_MUTEX_ACQUIRED",
    isMutexAcquired,
  }) as const;

export const setUserHoldingMutexAction = (blockedByUser: APIUserCompact | null | undefined) =>
  ({
    type: "SET_USER_HOLDING_MUTEX",
    blockedByUser,
  }) as const;

export const prepareRebaseAction = () =>
  ({
    // Sets the annotation in the store to the info stored in RebaseRelevantAnnotationState.
    type: "PREPARE_REBASING",
  }) as const;

export const finishedRebaseAction = () =>
  ({
    type: "FINISHED_REBASING",
  }) as const;

export const snapshotMappingDataForNextRebaseAction = (volumeLayerIdToUpdate: string) =>
  // This action updates the mapping rebase information for the given volume layer.
  // Should be triggered whenever the mapping is changed in sync with the backend.
  // E.g. when new parts of the partial mapping are loaded from the backend.
  // Never when the mapping is changed by the user via actions as these are not in sync
  // with the backend and only data in sync with the backend in allowed to be part of the rebase state.
  ({
    type: "SNAPSHOT_MAPPING_DATA_FOR_NEXT_REBASE_ACTION",
    volumeLayerIdToUpdate,
  }) as const;
export const finishedApplyingMissingUpdatesAction = () =>
  ({
    type: "FINISHED_APPLYING_MISSING_UPDATES",
  }) as const;

export const replaceSaveQueueAction = (newSaveQueue: SaveQueueEntry[]) =>
  ({ type: "REPLACE_SAVE_QUEUE", newSaveQueue }) as const;
