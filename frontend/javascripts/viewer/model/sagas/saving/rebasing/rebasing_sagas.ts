import type { ApiResult, RetryOptions } from "admin/api/api_result";
import { getUpdateActionLog } from "admin/rest_api";
import Toast from "libs/toast";
import { call, put } from "typed-redux-saga";
import type { APIUpdateActionBatch } from "types/api_types";
import { mayEditAnnotation } from "viewer/model/accessors/annotation_accessor";
import {
  dispatchEnsureTracingsWereDiffedToSaveQueueAction,
  finishedApplyingMissingUpdatesAction,
  finishedRebaseAction,
  finishForwardingUpdateActionsAction,
  rewindForRebaseAction,
  startForwardingUpdateActionsAction,
} from "viewer/model/actions/save_actions";
import type { Saga } from "viewer/model/sagas/effect_generators";
import { select } from "viewer/model/sagas/effect_generators";
import { Store } from "viewer/singletons";
import type { StoreAnnotation } from "viewer/store";
import {
  type ApplyingUpdateResults,
  getFailedIncorporateActionsReturnValue,
  type RebasingFailure,
  SuccessEmptyIncorporateActionsReturnValue,
} from "./applying_update_artifacts";
import { tryToIncorporateActions } from "./incorporate_update_actions_sagas";
import { resolveApplyingUpdateArtifacts } from "./mesh_artifact_resolution_sagas";
import {
  saveQueueEntriesToServerUpdateActionBatches,
  updatePendingProofreadingOperationInfo,
} from "./rebasing_helpers_sagas";
import { rewriteSaveQueueEntriesForReapplying } from "./rewrite_for_reapplying_sagas";

/*
 * This module performs one rebase round: it fetches the update actions that are missing locally,
 * applies them and – if the user has local, unsaved changes – re-applies these changes on top of
 * the newest server state (comparable to a git stash + pull + stash pop).
 * The rebase rounds are triggered by the version polling saga (see version_poll_saga.ts).
 */

const SAVING_CONFLICT_TOAST_KEY = "save_conflicts_warning";

export type RebasingSuccessInfo =
  | { successful: true }
  | { successful: false; failure: RebasingFailure };

export function* performRebasingIfNecessary(): Saga<RebasingSuccessInfo> {
  const collaborationMode = yield* select((state) => state.annotation.collaborationMode);
  const missingUpdateActionsResult = yield* call(fetchNewestMissingUpdateActions);
  if (!missingUpdateActionsResult.ok) {
    // Only errors that are not retried (e.g., 4xx) end up here. The user was already
    // notified by the api function.
    const { error } = missingUpdateActionsResult;
    return {
      successful: false,
      failure: {
        reason: "Fetching the missing update actions failed",
        error: error.cause,
        details: { errorKind: error.kind, status: error.status },
      },
    };
  }
  const missingUpdateActions = missingUpdateActionsResult.value;
  const hasRemoteUnseenChanges = missingUpdateActions.length > 0;

  if (!hasRemoteUnseenChanges) {
    // Neither a rebase nor a fast-forward is necessary since there are no remote changes to incorporate.
    return { successful: true };
  }

  // Ensure tracings were diffed so that the save queue can be inspected afterwards.
  const annotation = yield* select((state) => state.annotation);
  yield dispatchEnsureTracingsWereDiffedToSaveQueueAction(Store.dispatch, annotation);
  // saveQueueEntries must not change during performRebasing saga. This is achieved
  // by the operationContext in which performRebasing is called (see caller).
  const saveQueueEntries = yield* select((state) => state.save.queue);
  const hasLocalUnsavedChanges = saveQueueEntries.length > 0;

  // Side note: In a scenario where a user has an annotation open that they are not allowed to edit but another user is actively editing,
  // this function will notice that there are missingUpdateActions and apply them. This should not trigger a full "rewinding" rebase
  // and should be ensured because "not allowed to edit" means the save queue would be empty. Thus no hasLocalUnsavedChanges = false.
  if (hasLocalUnsavedChanges && collaborationMode !== "Concurrent") {
    Toast.error("Could not save this annotation. Please refresh the page.");
    return {
      successful: false,
      failure: {
        reason: "Full rebase needed even though collaborationMode is not Concurrent",
        details: { collaborationMode },
      },
    };
  }
  const annotationBeforeRebase = yield* select((state) => state.annotation);
  if (hasLocalUnsavedChanges) {
    // As a side-effect of this call, the annotation in the store will be set to the info stored in RebaseRelevantAnnotationState
    // (similar to a git stash before doing a git pull & git stash pop).
    // Additionally, the diffing saga is disabled temporarily to avoid filling the save queue with
    // changes that originate from the server.
    yield* put(rewindForRebaseAction()); // isRebasingOrForwarding := true and sets annotation := known server annotation state
  } else {
    // If no rebasing is currently done, we still need to inform the diffing saga, that the currently replayed
    // update actions originate from the server and should not be considered during diffing.
    yield put(startForwardingUpdateActionsAction()); // isRebasingOrForwarding := true
  }

  try {
    const applyingResult = yield* call(applyNewestMissingUpdateActions, missingUpdateActions);
    if (!applyingResult.success) {
      return {
        successful: false,
        failure: withPhase(
          applyingResult.failure ?? { reason: "Applying the missing update actions failed" },
          "applyMissingUpdateActions",
        ),
      };
    }
    yield* call(resolveApplyingUpdateArtifacts, applyingResult.artifactInfos);
    if (hasLocalUnsavedChanges) {
      // Only if a rewinding rebase was necessary, the pending update actions in the save queue must be reapplied.
      // Note that we do not need to call resolveApplyingUpdateArtifacts(_artifactInfos) here
      // because we are merely re-applying our own (rebased) update actions. The original
      // emitter of these updates (e.g., the proofreading saga) is responsible for handling
      // such updates.
      // TODO #9711: Refactor this?
      const {
        success,
        artifactInfos: _artifactInfos,
        failure,
      } = yield* call(
        reapplyUpdateActionsFromSaveQueue, // isRebasingOrForwarding := false (in happy case)
        missingUpdateActions,
        annotationBeforeRebase,
      );
      if (!success) {
        return {
          successful: false,
          failure: withPhase(
            failure ?? { reason: "Re-applying the save queue failed" },
            "reapplySaveQueue",
          ),
        };
      }
    }
    return { successful: true };
  } catch (exception) {
    // If the rebasing fails for some reason, we don't want to crash the entire
    // saga.
    console.error("in save saga, got exception, terminating ...");
    console.warn(exception);
    Toast.error(
      "An unrecoverable error occurred while synchronizing this annotation. Please refresh the page.",
      { sticky: true },
    );
    return {
      successful: false,
      failure: { reason: "Exception while rebasing", error: exception },
    };
  } finally {
    // isRebasingOrForwarding := false
    yield* put(
      hasLocalUnsavedChanges ? finishedRebaseAction() : finishForwardingUpdateActionsAction(),
    );
  }
}

// Adds the rebasing phase in which the failure happened to the details.
function withPhase(failure: RebasingFailure, phase: string): RebasingFailure {
  return { ...failure, details: { ...failure.details, phase } };
}

// Without the missing update actions, rebasing (and thus saving) cannot continue. Therefore, the
// request is retried until the server is reachable again (with an exponential backoff of at most
// one minute). In tests, the delays are much shorter.
const FETCH_MISSING_UPDATE_ACTIONS_RETRY_OPTIONS: RetryOptions = {
  retries: Number.POSITIVE_INFINITY,
  initialDelayMs: process.env.IS_TESTING ? 1 : 1000,
  backoffFactor: 2,
  maxDelayMs: process.env.IS_TESTING ? 10 : 60 * 1000,
};

function* fetchNewestMissingUpdateActions(): Saga<ApiResult<APIUpdateActionBatch[]>> {
  const tracingStoreUrl = yield* select((state) => state.annotation.tracingStore.url);
  const annotationId = yield* select((state) => state.annotation.annotationId);
  const versionOnClient = yield* select((state) => {
    return state.annotation.version;
  });

  // The request is retried without limit. Abort it when this saga is cancelled (e.g., because
  // the annotation view is left). Otherwise, the retries would continue in the background.
  // Aborted requests are not retried.
  const abortController = new AbortController();
  try {
    // Fetch all update actions that belong to a version that is newer than
    // versionOnClient. If there are none, the array will be empty.
    // The order is ascending in the version number ([v_n, v_(n+1), ...]).
    const newerActions = yield* call(
      getUpdateActionLog,
      tracingStoreUrl,
      annotationId,
      versionOnClient + 1,
      undefined,
      false,
      true,
      { signal: abortController.signal },
      FETCH_MISSING_UPDATE_ACTIONS_RETRY_OPTIONS,
    );
    return newerActions;
  } finally {
    abortController.abort();
  }
}

function* applyNewestMissingUpdateActions(
  actions: APIUpdateActionBatch[],
): Saga<ApplyingUpdateResults> {
  if (actions.length === 0) {
    Toast.close(SAVING_CONFLICT_TOAST_KEY);
    return SuccessEmptyIncorporateActionsReturnValue;
  }
  const mayEdit = yield* select((state) => mayEditAnnotation(state));
  // Note: any exception thrown here is intentionally not caught. It propagates to
  // performRebasingIfNecessary's outer try/catch, which terminates polling -- the same
  // way a hard error in reapplyUpdateActionsFromSaveQueue is already handled, since that
  // function has no local try/catch either.
  const { success, artifactInfos, failure } = yield* tryToIncorporateActions(actions, false);
  // Updates the annotation state used for future rebase operation to the current state with the missingUpdateActions applied.
  yield* put(finishedApplyingMissingUpdatesAction()); // knownServerState := annotation
  if (success) {
    yield* call(updatePendingProofreadingOperationInfo);
    return { success: true, artifactInfos };
  }

  const hasPendingUpdates = (yield* select((state) => state.save.queue)).length > 0;

  let msg = "";
  if (!mayEdit) {
    msg =
      "A newer version of this annotation was found on the server. Reload the page to see the newest changes.";
  } else if (hasPendingUpdates) {
    msg =
      "A newer version of this annotation was found on the server. Your current changes to this annotation cannot be saved anymore. Please reload.";
  } else {
    msg =
      "A newer version of this annotation was found on the server. Please reload the page to see the newer version. Otherwise, new changes to this annotation cannot be saved anymore.";
  }
  Toast.warning(msg, {
    sticky: true,
    key: SAVING_CONFLICT_TOAST_KEY,
  });
  return getFailedIncorporateActionsReturnValue(
    failure ?? { reason: "Applying the missing update actions failed" },
  );
}

function* reapplyUpdateActionsFromSaveQueue(
  // appliedBackendUpdateActions contains the backend actions that were used to forward the local state
  // during rebase. These actions can be used as additional information to adapt the local, pending
  // save queue entries to the rebase.
  appliedBackendUpdateActions: APIUpdateActionBatch[],
  annotationBeforeRebase: StoreAnnotation,
): Saga<ApplyingUpdateResults> {
  const saveQueueEntries = yield* select((state) => state.save.queue);
  const currentVersion = yield* select((state) => state.annotation.version);
  if (saveQueueEntries.length === 0) {
    return SuccessEmptyIncorporateActionsReturnValue;
  }
  // Potentially update save queue entries to state after applying missing backend actions.
  // Properties like unmapped segment ids of proofreading actions might have changed and are updated here.
  // updateSaveQueueEntriesToStateAfterRebase might do some additional needed backend requests.
  const { success, updatedSaveQueue } = yield* call(
    rewriteSaveQueueEntriesForReapplying,
    appliedBackendUpdateActions,
    annotationBeforeRebase,
  );
  if (success) {
    const saveQueueAsServerUpdateActionBatches = saveQueueEntriesToServerUpdateActionBatches(
      updatedSaveQueue,
      currentVersion,
    );
    const {
      success: successfullyAppliedSaveQueueUpdates,
      artifactInfos,
      failure,
    } = yield* tryToIncorporateActions(saveQueueAsServerUpdateActionBatches, true);
    if (successfullyAppliedSaveQueueUpdates) {
      return { success: true, artifactInfos };
    }
    return getFailedIncorporateActionsReturnValue(
      failure ?? { reason: "Re-applying the save queue failed" },
    );
  }
  return getFailedIncorporateActionsReturnValue({
    reason: "Rewriting the save queue for re-applying failed",
  });
}
