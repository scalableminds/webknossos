import { getAgglomeratesForSegmentsFromTracingstore, getUpdateActionLog } from "admin/rest_api";
import features from "features";
import ErrorHandling from "libs/error_handling";
import { NumberLikeMapWrapper } from "libs/number_like_map_wrapper";
import Toast from "libs/toast";
import { addToNestedMap, addToSetMap } from "libs/utils";
import sum from "lodash-es/sum";
import { buffers, type Channel } from "redux-saga";
import {
  actionChannel,
  all,
  call,
  delay,
  flush,
  fork,
  put,
  race,
  takeEvery,
} from "typed-redux-saga";
import type { APIUpdateActionBatch } from "types/api_types";
import type { Vector3 } from "viewer/constants";
import {
  isAnnotationEditableByNonOwners,
  mayEditAnnotation,
} from "viewer/model/accessors/annotation_accessor";
import {
  getSegmentationLayerByName,
  getVisibleSegmentationLayer,
} from "viewer/model/accessors/dataset_accessor";
import { hasTracing } from "viewer/model/accessors/tracing_accessor";
import {
  getAllLoadedMeshes,
  getMeshInfoForSegment,
  getSegmentsForLayer,
  getVolumeTracingById,
  isMeshLoaded,
} from "viewer/model/accessors/volumetracing_accessor";
import type { Action } from "viewer/model/actions/actions";
import {
  removeMeshAction,
  showManyBucketUpdatesWarningAction,
} from "viewer/model/actions/annotation_actions";
import {
  ensureLayerMappingsAreLoadedAction,
  type SetLayerMappingsAction,
} from "viewer/model/actions/dataset_actions";
import {
  dispatchEnsureTracingsWereDiffedToSaveQueueAction,
  type EnsureHasNewestVersionAction,
  finishedApplyingMissingUpdatesAction,
  finishedRebaseAction,
  finishForwardingUpdateActionsAction,
  type NotifyAboutUpdatedBucketsAction,
  rewindForRebaseAction,
  setPendingProofreadingOperationInfoAction,
  setVersionNumberAction,
  startForwardingUpdateActionsAction,
} from "viewer/model/actions/save_actions";
import { setMappingAction, setMappingDataAction } from "viewer/model/actions/settings_actions";
import { applySkeletonUpdateActionsFromServerAction } from "viewer/model/actions/skeletontracing_actions";
import {
  applyVolumeUpdateActionsFromServerAction,
  setHasEditableMappingAction,
  setMappingIsLockedAction,
} from "viewer/model/actions/volumetracing_actions";
import { globalPositionToBucketPositionWithMag } from "viewer/model/helpers/position_converter";
import type { Saga } from "viewer/model/sagas/effect_generators";
import { select, take } from "viewer/model/sagas/effect_generators";
import { ensureWkInitialized } from "viewer/model/sagas/ready_sagas";
import { Model, Store } from "viewer/singletons";
import type { StoreAnnotation, WebknossosState } from "viewer/store";
import { getOrCreateOperationContext } from "../operation_context_saga";
import {
  spawnUntilCanceled,
  takeEveryWithBatchActionSupport,
  waitFor,
  waitUntilNoActiveOperations,
} from "../saga_helpers";
import {
  splitAgglomeratesInMapping,
  updateMappingWithMerge,
} from "../volume/proofreading/local_mapping_update_sagas";
import {
  getMeshDisplayPropsByOldAgglomerateId,
  type PreservedMeshDisplayProps,
  refreshAffectedMeshes,
} from "../volume/proofreading/segment_and_mesh_refresh_sagas";
import {
  saveQueueEntriesToServerUpdateActionBatches,
  updateSaveQueueEntriesToStateAfterRebase,
} from "./rebasing_helpers_sagas";
import { pushSaveQueueAsync } from "./save_queue_draining_saga";
import { setupSavingForAnnotation, setupSavingForTracingType } from "./save_queue_filling_saga";

function* setupSavingToServer(): Saga<void> {
  // This saga continuously drains the save queue by sending its content to the server.
  yield* fork(pushSaveQueueAsync);
  // The following sagas are responsible for filling the save queue with the update actions.
  yield* takeEvery("INITIALIZE_ANNOTATION_WITH_TRACINGS", setupSavingForAnnotation);
  yield* takeEveryWithBatchActionSupport("INITIALIZE_SKELETONTRACING", setupSavingForTracingType);
  yield* takeEveryWithBatchActionSupport("INITIALIZE_VOLUMETRACING", setupSavingForTracingType);
  yield* takeEvery("WK_READY", watchForNumberOfBucketsInSaveQueue);
}

export const VERSION_POLL_INTERVAL_COLLAB = process.env.IS_TESTING ? 500 : 10 * 1000;
const VERSION_POLL_INTERVAL_READ_ONLY = process.env.IS_TESTING ? 250 : 5 * 1000;
const VERSION_POLL_INTERVAL_SINGLE_EDITOR = process.env.IS_TESTING ? 1 * 1000 : 30 * 1000;
// interval at which the number of buckets in save queue is checked
const CHECK_NUMBER_OF_BUCKETS_IN_SAVE_QUEUE_INTERVAL_MS = 10 * 1000;
// sliding time window for which the number of buckets in save queue is summed up
const CHECK_NUMBER_OF_BUCKETS_SLIDING_WINDOW_MS = 120 * 1000;

function* watchForNumberOfBucketsInSaveQueue(): Saga<void> {
  const bucketSaveWarningThreshold = features().bucketSaveWarningThreshold;
  let bucketsForCurrentInterval = 0;
  let currentBucketCounts: Array<number> = [];
  const bucketCountArrayLength = Math.floor(
    CHECK_NUMBER_OF_BUCKETS_SLIDING_WINDOW_MS / CHECK_NUMBER_OF_BUCKETS_IN_SAVE_QUEUE_INTERVAL_MS,
  );
  yield* takeEvery("NOTIFY_ABOUT_UPDATED_BUCKETS", (action: NotifyAboutUpdatedBucketsAction) => {
    bucketsForCurrentInterval += action.count;
  });
  while (true) {
    yield* delay(CHECK_NUMBER_OF_BUCKETS_IN_SAVE_QUEUE_INTERVAL_MS);
    const sumOfBuckets = sum(currentBucketCounts);
    if (sumOfBuckets > bucketSaveWarningThreshold) {
      Store.dispatch(showManyBucketUpdatesWarningAction());
    }
    currentBucketCounts.push(bucketsForCurrentInterval);
    if (currentBucketCounts.length > bucketCountArrayLength) {
      currentBucketCounts.shift();
    }
    bucketsForCurrentInterval = 0;
  }
}

function* getPollInterval(): Saga<number> {
  const allowSave = yield* select((state) => state.annotation.restrictions.allowSave);
  if (!allowSave) {
    // The current user may not edit/save the annotation.
    return VERSION_POLL_INTERVAL_READ_ONLY;
  }

  const othersMayEdit = yield* select((state) => isAnnotationEditableByNonOwners(state.annotation));
  if (othersMayEdit) {
    // Other users may edit the annotation.
    return VERSION_POLL_INTERVAL_COLLAB;
  }
  // The current user is the only one who can edit the annotation.
  return VERSION_POLL_INTERVAL_SINGLE_EDITOR;
}

function needsPollAnnotationUpdates(state: WebknossosState): "yes" | "no" | "later" {
  // We usually want to poll for new annotation versions. We merely avoid this
  // in the following cases:

  // If the version restore view is open, newer versions should not be fetched
  // as this could mess up the current state.
  // Similarly, we should not poll for updates when a rebase is in progress.
  const { isRestoringVersion, showVersionRestore } = state.uiInformation;
  const isVersionRestoreActive = showVersionRestore && !isRestoringVersion;
  const { isRebasingOrForwarding } = state.save.rebaseRelevantServerAnnotationState;
  if (isVersionRestoreActive || isRebasingOrForwarding) {
    return "later";
  }

  if (state.save.isSavingDisabled) {
    // When saving is disabled, the user is free to edit the annotation however they like.
    // If they had a mutex before, that will be released.
    // Therefore, other users may edit the annotation at the same time.
    // We must not poll for updates, because we cannot incorporate all possible update actions
    // while having local changes.
    return "no";
  }

  // If the current user may edit the annotation while the collab mode is not Concurrent,
  // we don't need to fetch newer versions (because there shouldn't be any since nobody else
  // should be allowed to push a newer version). This is the case when the current user
  // is either the owner or a collaborator with the mutex.
  const { isUpdatingCurrentlyAllowed } = state.annotation;
  const { collaborationMode } = state.annotation;
  const mayEditInNonConcurrentMode =
    isUpdatingCurrentlyAllowed && collaborationMode !== "Concurrent";
  if (mayEditInNonConcurrentMode) {
    // WK should already show the newest version of the annotation.
    // However, there is a rare chance of two problematic scenarios currently:
    // - the current user opened the annotation twice (we don't guard against this in OwnerOnly mode, yet)
    // - there was a race condition where the current user C loads version X, another user U pushes
    //   version X+1 and U releases the mutex, only then C acquires the mutex. Now, C doesn't know about
    //   X+1.
    // The worst case is that the users gets a 409 error during saving (thus, losing 30 seconds of work).
    // We can improve this in the future by always polling once all update actions are supported in rebasing
    // (see #9052)
    return "no";
  }

  // If there are no tracings, we don't need need to poll for updates
  if (!hasTracing(state.annotation)) {
    return "no";
  }
  // In all other cases, poll
  return "yes";
}

function* fetchNewestMissingUpdateActions(): Saga<APIUpdateActionBatch[]> {
  const tracingStoreUrl = yield* select((state) => state.annotation.tracingStore.url);
  const annotationId = yield* select((state) => state.annotation.annotationId);
  const versionOnClient = yield* select((state) => {
    return state.annotation.version;
  });

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
  );
  return newerActions;
}

const SAVING_CONFLICT_TOAST_KEY = "save_conflicts_warning";

// This type is designed to include information needed after applying update actions via tryToIncorporateActions.
// This info is passed up the saga calling hierarchy.
// E.g. info about which auxiliary agglomerate meshes need reloading and which need to be removed.
// This info can then be used to trigger side effects after saving is done to e.g. reload the newest auxiliary agglomerate meshes.

type ApplyingUpdateArtifacts = {
  // All properties having the layer name / tracing id as a key.
  meshIdsToRemovePerLayer: ReadonlyMap<string, ReadonlySet<number>>;
  // Maps for each layer from agglomerate ids whose meshes should be (re)loaded to the display
  // properties (opacity and visibility) the reloaded mesh should inherit from the agglomerate it
  // originated from (empty if nothing was stored for the original mesh). The key set defines which
  // meshes to load.
  meshesToLoadPerLayer: ReadonlyMap<string, ReadonlyMap<number, PreservedMeshDisplayProps>>;
};

type ApplyingUpdateResults = { success: boolean; artifactInfos: ApplyingUpdateArtifacts };

const FailedIncorporateActionsReturnValue: ApplyingUpdateResults = {
  success: false,
  artifactInfos: {
    meshIdsToRemovePerLayer: new Map(),
    meshesToLoadPerLayer: new Map(),
  },
};
const SuccessEmptyIncorporateActionsReturnValue: ApplyingUpdateResults = {
  success: true,
  artifactInfos: {
    meshIdsToRemovePerLayer: new Map(),
    meshesToLoadPerLayer: new Map(),
  },
};

// This function updates the agglomerate ids of source- and targetInformation from proofreading actions,
// to ensure that the post processing of a proofreading interaction by a saga in proofread_saga.tsx has
// agglomerate id information from the state where the latest backend updates were applied but the own
// mapping changes are not yet applied. This is needed to have correct information about what agglomerate ids
// were actually affected by a proofreading action done by the local user. The info correctness is essential
// to properly reload and synchronize loaded agglomerate trees and meshes.
function* updatePendingProofreadingOperationInfoAction() {
  const proofreadingPostProcessingInfo = yield* select(
    (state) => state.save.proofreadingPostProcessingInfo,
  );
  if (proofreadingPostProcessingInfo == null) {
    return;
  }
  const { tracingId, sourceInfo, targetInfo } = proofreadingPostProcessingInfo;
  const activeMapping = yield* select(
    (store) => store.temporaryConfiguration.activeMappingByLayer[tracingId],
  );

  let sourceAgglomerateId: number | undefined;
  let targetAgglomerateId: number | undefined;

  if (activeMapping.mapping != null) {
    const mappingWrapper = new NumberLikeMapWrapper(activeMapping.mapping);
    sourceAgglomerateId = mappingWrapper.getAsNumber(sourceInfo.unmappedId);
    if (targetInfo) {
      targetAgglomerateId = mappingWrapper.getAsNumber(targetInfo.unmappedId);
    }
  }

  if (sourceAgglomerateId != null && (targetInfo == null || targetAgglomerateId != null)) {
    yield* put(
      setPendingProofreadingOperationInfoAction({
        tracingId,
        sourceInfo: { ...sourceInfo, agglomerateId: sourceAgglomerateId },
        targetInfo: targetInfo
          ? {
              ...targetInfo,
              agglomerateId:
                // If targetInfo != null, targetAgglomerateId will be != null, too
                // (we ensure this in the if-condition).
                targetAgglomerateId as number,
            }
          : null,
      }),
    );
  } else {
    // In the rare case where after applying the backend updates the mapping information
    // for the source and targetInfo is no longer present in the mapping, load this missing info from the backend.
    const tracingStoreUrl = yield* select((state) => state.annotation.tracingStore.url);
    const annotationId = yield* select((state) => state.annotation.annotationId);
    const annotationVersion = yield* select((state) => state.annotation.version);
    const idsToRequest = targetInfo
      ? [sourceInfo.unmappedId, targetInfo.unmappedId]
      : [sourceInfo.unmappedId];
    const agglomerateInfoFromServer = yield* call(
      getAgglomeratesForSegmentsFromTracingstore,
      tracingStoreUrl,
      tracingId,
      new Set(idsToRequest),
      annotationId,
      annotationVersion,
    );
    const mappingWrapper = new NumberLikeMapWrapper(agglomerateInfoFromServer);
    const sourceAgglomerateIdFromServer = mappingWrapper.get(sourceInfo.unmappedId);
    const targetAgglomerateIdFromServer = targetInfo
      ? mappingWrapper.get(targetInfo.unmappedId)
      : null;

    yield* put(
      setPendingProofreadingOperationInfoAction({
        tracingId,
        sourceInfo: {
          ...sourceInfo,
          agglomerateId: Number(sourceAgglomerateIdFromServer ?? sourceInfo.agglomerateId),
        },
        targetInfo: targetInfo
          ? {
              ...targetInfo,
              agglomerateId: Number(targetAgglomerateIdFromServer ?? targetInfo.agglomerateId),
            }
          : null,
      }),
    );
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
  try {
    const { success, artifactInfos } = yield* tryToIncorporateActions(actions, false);
    // Updates the annotation state used for future rebase operation to the current state with the missingUpdateActions applied.
    yield* put(finishedApplyingMissingUpdatesAction()); // knownServerState := annotation
    if (success) {
      yield* call(updatePendingProofreadingOperationInfoAction);
      return { success: true, artifactInfos };
    }
  } catch (exc) {
    // Afterwards, the user will be asked to reload the page.
    console.error("Error during application of update actions", exc);
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
  return FailedIncorporateActionsReturnValue;
}

function* fulfillAllEnsureHasNewestVersionActions(
  ensureHasNewestVersion: Action | undefined,
  channel: Channel<EnsureHasNewestVersionAction>,
) {
  // drain all accumulated actions at once
  const pendingActions: EnsureHasNewestVersionAction[] = yield* flush(channel);

  // include the first action we already took from the race
  const actionsToProcess = ensureHasNewestVersion
    ? [ensureHasNewestVersion, ...pendingActions]
    : pendingActions;

  for (const action of actionsToProcess) {
    (action as EnsureHasNewestVersionAction).callback();
  }
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
    updateSaveQueueEntriesToStateAfterRebase,
    appliedBackendUpdateActions,
    annotationBeforeRebase,
  );
  if (success) {
    const saveQueueAsServerUpdateActionBatches = saveQueueEntriesToServerUpdateActionBatches(
      updatedSaveQueue,
      currentVersion,
    );
    const { success: successfullyAppliedSaveQueueUpdates, artifactInfos } =
      yield* tryToIncorporateActions(saveQueueAsServerUpdateActionBatches, true);
    if (successfullyAppliedSaveQueueUpdates) {
      return { success: true, artifactInfos };
    }
  }
  return FailedIncorporateActionsReturnValue;
}

type RebasingSuccessInfo = { successful: boolean; shouldTerminate: boolean };
function* performRebasingIfNecessary(): Saga<RebasingSuccessInfo> {
  const collaborationMode = yield* select((state) => state.annotation.collaborationMode);
  const missingUpdateActions = yield* call(fetchNewestMissingUpdateActions);
  const hasRemoteUnseenChanges = missingUpdateActions.length > 0;

  if (!hasRemoteUnseenChanges) {
    // Neither a rebase nor a fast-forward is necessary since there are no remote changes to incorporate.
    return { successful: true, shouldTerminate: false };
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
    ErrorHandling.notify(
      new Error("Full rebase needed even though collaborationMode is not Concurrent."),
    );
    Toast.error("Could not save this annotation. Please refresh the page.");
    return { successful: false, shouldTerminate: true };
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
      return { successful: false, shouldTerminate: false };
    }
    yield* call(resolveApplyingUpdateArtifacts, applyingResult.artifactInfos);
    if (hasLocalUnsavedChanges) {
      // Only if a rewinding rebase was necessary, the pending update actions in the save queue must be reapplied.
      // Note that we do not need to call resolveApplyingUpdateArtifacts(_artifactInfos) here
      // because we are merely re-applying our own (rebased) update actions. The original
      // emitter of these updates (e.g., the proofreading saga) is responsible for handling
      // such updates.
      // TODO #9711: Refactor this?
      const { success, artifactInfos: _artifactInfos } = yield* call(
        reapplyUpdateActionsFromSaveQueue, // isRebasingOrForwarding := false (in happy case)
        missingUpdateActions,
        annotationBeforeRebase,
      );
      if (!success) {
        return { successful: false, shouldTerminate: false };
      }
    }
    return { successful: true, shouldTerminate: false };
  } catch (exception) {
    // If the rebasing fails for some reason, we don't want to crash the entire
    // saga.
    console.error("in save saga, got exception, terminating ...");
    console.warn(exception);
    // @ts-expect-error
    ErrorHandling.notify(exception);
    Toast.error(
      "An unrecoverable error occurred while synchronizing this annotation. Please refresh the page.",
      { sticky: true },
    );
    // A hard error was thrown. Terminate this saga.
    return { successful: false, shouldTerminate: true };
  } finally {
    // isRebasingOrForwarding := false
    yield* put(
      hasLocalUnsavedChanges ? finishedRebaseAction() : finishForwardingUpdateActionsAction(),
    );
  }
}
const REBASING_BUSY_BLOCK_REASON = "Syncing Annotation";

function* maybeRequeuePollAndWait(
  ensureHasNewestVersion: EnsureHasNewestVersionAction | undefined,
) {
  // We need to postpone the poll operation (because the version restore is open).
  if (ensureHasNewestVersion != null) {
    // The ensureHasNewestVersion action was already dequeued from the channel.
    // Put it back by dispatching it again.
    yield* put(ensureHasNewestVersion);
    // Now, wait in a throttled manner until needsPollAnnotationUpdates becomes "yes".
    yield* waitFor((state) => needsPollAnnotationUpdates(state) === "yes");
  }
}

function* watchForNewerAnnotationVersion(): Saga<void> {
  yield* call(ensureWkInitialized);

  const channel = yield* actionChannel<EnsureHasNewestVersionAction>(
    ["ENSURE_HAS_NEWEST_VERSION"],
    // If multiple actions are sent to this buffer (without consumption in between),
    // we want to flush them all at once. This is achieved by using an expanding buffer
    // and flushing all events and calling their callbacks every time an ensureHasNewestVersion
    // action is resolved.
    buffers.expanding<EnsureHasNewestVersionAction>(1),
  );
  while (true) {
    const interval = yield* call(getPollInterval);
    let { ensureHasNewestVersion: untypedEnsureHasNewestVersion } = yield* race({
      sleep: delay(interval),
      ensureHasNewestVersion: take(channel),
    });
    const ensureHasNewestVersion = untypedEnsureHasNewestVersion as
      | EnsureHasNewestVersionAction
      | undefined;
    const needsCheckForUpdatesOnServer = yield* select(needsPollAnnotationUpdates);
    if (needsCheckForUpdatesOnServer === "no") {
      // We don't need to poll for the newest version (because we can safely assume that
      // we already know about it).
      yield* call(fulfillAllEnsureHasNewestVersionActions, ensureHasNewestVersion, channel);
      continue;
    } else if (needsCheckForUpdatesOnServer === "later") {
      yield* maybeRequeuePollAndWait(ensureHasNewestVersion);
      continue;
    }

    // Now, let's initiate the actual rebasing. For that, we acquire the operation context
    // to block user actions from interfering with rebasing.
    const ctx = yield* getOrCreateOperationContext(
      {
        id: "REBASE",
        description: REBASING_BUSY_BLOCK_REASON,
        behaviorWhenDisallowed: "ignore",
      },
      ensureHasNewestVersion?.operationContext ?? null,
    );
    if (ctx == null) {
      yield* maybeRequeuePollAndWait(ensureHasNewestVersion);
      continue;
    }
    const { successful, shouldTerminate } = yield* ctx.execute(function* () {
      return yield* call(performRebasingIfNecessary);
    });

    if (shouldTerminate) {
      // A hard error was thrown. Terminate this saga.
      break;
    }
    if (successful) {
      yield* call(fulfillAllEnsureHasNewestVersionActions, ensureHasNewestVersion, channel);
    } else {
      // The user was already notified about the current annotation being outdated.
      // There is not much else we can do now. Sleep for 5 minutes.
      yield* delay(5 * 60 * 1000);
    }
  }
}

export function* tryToIncorporateActions(
  newerActions: APIUpdateActionBatch[],
  areUnsavedChangesOfUser: boolean,
): Saga<{ success: boolean; artifactInfos: ApplyingUpdateArtifacts }> {
  // After all actions were incorporated, volume buckets and hdf5 mappings
  // are reloaded (if they exist and necessary). This is done as a
  // "finalization step", because it requires that the newest version is set
  // in the store annotation. Also, it only needs to happen once (instead of
  // per action).
  const refreshLayerFunctionByTracing: Record<string, () => unknown> = {};
  function* finalize() {
    for (const fn of Object.values(refreshLayerFunctionByTracing)) {
      yield* call(fn);
    }
  }

  // Tracks which agglomerate ids were changed of which the frontend has loaded meshes to assist proofreading.
  // Maps from the old agglomerate id to a potentially new one.
  // Duplicates are later ignored when refreshing the meshes.
  const meshIdsToRemovePerLayer: Map<string, Set<number>> = new Map();
  // Maps each layer's agglomerate ids whose meshes should be (re)loaded to the display properties
  // (opacity and visibility) the reloaded mesh should inherit from the agglomerate it originated
  // from (empty if nothing was stored). These must be gathered here while the original meshes still
  // exist; the meshes are only removed later in resolveApplyingUpdateArtifacts.
  const meshesToLoadPerLayer: Map<string, Map<number, PreservedMeshDisplayProps>> = new Map();
  function recordMeshToLoad(
    tracingId: string,
    agglomerateId: number,
    displayProps: PreservedMeshDisplayProps,
  ) {
    if (!meshesToLoadPerLayer.has(tracingId)) {
      meshesToLoadPerLayer.set(tracingId, new Map());
    }
    meshesToLoadPerLayer.get(tracingId)?.set(agglomerateId, displayProps);
  }

  for (const actionBatch of newerActions) {
    // Per layer: maps each split segment id (segmentId1/segmentId2 of splitAgglomerate actions)
    // to the agglomerate id it belonged to before the split.
    const splitSegmentIdToOldAgglomeratePerLayer: Map<string, Map<number, number>> = new Map();
    for (const action of actionBatch.value) {
      switch (action.name) {
        /////////////
        // Updates to user-specific state can be ignored if not from the active user (areUnsavedChangesOfUser = true):
        //   Camera
        case "updateCamera":
        case "updateTdCamera": {
          // Can always be ignored as not part of the rebased state, thus no replaying of the update action needed due to rebasing.
          break;
        }
        //   Active items

        //   User specific skeleton actions -- only applied if coming from current user.
        case "updateActiveNode":
        case "updateActiveTree":
        case "updateTreeVisibility":
        case "updateTreeGroupVisibility":
        case "updateUserBoundingBoxVisibilityInSkeletonTracing":
        case "updateTreeGroupsExpandedState": {
          if (areUnsavedChangesOfUser) {
            yield* put(applySkeletonUpdateActionsFromServerAction([action]));
          }
          break;
        }
        //   User specific volume actions -- only applied if coming from current user.
        case "updateActiveSegmentId":
        case "updateSegmentVisibility":
        case "updateSegmentGroupVisibility":
        case "updateUserBoundingBoxVisibilityInVolumeTracing":
        case "updateSegmentGroupsExpandedState": {
          if (areUnsavedChangesOfUser) {
            yield* put(applyVolumeUpdateActionsFromServerAction([action]));
          }
          break;
        }
        /////////////
        // Skeleton
        /////////////
        case "createTree":
        case "updateTree":
        case "createNode":
        case "createEdge":
        case "updateNode":
        case "moveTreeComponent":
        case "deleteTree":
        case "deleteEdge":
        case "deleteNode":
        case "updateTreeEdgesVisibility":
        case "updateTreeGroups":
        // Skeleton User Bounding Boxes
        case "addUserBoundingBoxInSkeletonTracing":
        case "updateUserBoundingBoxInSkeletonTracing":
        case "deleteUserBoundingBoxInSkeletonTracing": {
          yield* put(applySkeletonUpdateActionsFromServerAction([action]));
          break;
        }

        /////////////
        // Volume
        /////////////
        case "updateBucket": {
          const { value } = action;
          const cube = Model.getCubeByLayerName(value.actionTracingId);

          const dataLayer = Model.getLayerByName(value.actionTracingId);
          const bucketAddress = globalPositionToBucketPositionWithMag(
            value.position,
            value.mag,
            value.additionalCoordinates,
          );

          const bucket = cube.getBucket(bucketAddress);
          if (bucket != null && bucket.type !== "null") {
            cube.removeBucket(bucket);
            refreshLayerFunctionByTracing[value.actionTracingId] = () => {
              dataLayer.layerRenderingManager.refresh();
            };
          }
          break;
        }
        case "deleteSegmentData": {
          const { value } = action;
          const { actionTracingId, id } = value;
          const cube = Model.getCubeByLayerName(actionTracingId);
          const dataLayer = Model.getLayerByName(actionTracingId);

          cube.removeBucketsIf((bucket) => bucket.containsValue(id));
          refreshLayerFunctionByTracing[value.actionTracingId] = () => {
            dataLayer.layerRenderingManager.refresh();
          };
          break;
        }
        case "updateLargestSegmentId":
        case "updateVolumeBucketDataHasChanged":
        case "createSegment":
        case "mergeSegmentItems":
        case "deleteSegment":
        case "updateSegmentPartial":
        case "updateMetadataOfSegment":
        case "upsertSegmentGroup":
        case "deleteSegmentGroup":
        // Volume User Bounding Boxes
        case "addUserBoundingBoxInVolumeTracing":
        case "deleteUserBoundingBoxInVolumeTracing":
        case "updateUserBoundingBoxInVolumeTracing": {
          yield* put(applyVolumeUpdateActionsFromServerAction([action]));
          break;
        }

        // Proofreading
        case "mergeAgglomerate": {
          const { actionTracingId, agglomerateId1, agglomerateId2 } = action.value;
          if (agglomerateId1 == null || agglomerateId2 == null) {
            console.log(
              "Cannot apply mergeAgglomerate action due to agglomerateId1 or agglomerateId2 not being provided in the action",
              action.value,
            );
            yield* call(finalize);
            return FailedIncorporateActionsReturnValue;
          }
          const activeMapping = yield* select(
            (store) => store.temporaryConfiguration.activeMappingByLayer[actionTracingId],
          );
          yield* call(
            updateMappingWithMerge,
            actionTracingId,
            activeMapping,
            agglomerateId1,
            agglomerateId2,
            !areUnsavedChangesOfUser,
          );
          if (areUnsavedChangesOfUser) {
            // As this is a self-triggered proofreading action,  the proofreading saga
            // itself takes care of reloading the meshes, no need to track this here.
            break;
          }
          const hasAnyOfBothAgglomerateMeshesLoaded = yield* select(
            (state) =>
              isMeshLoaded(state, agglomerateId1, actionTracingId) ||
              isMeshLoaded(state, agglomerateId2, actionTracingId),
          );
          if (!hasAnyOfBothAgglomerateMeshesLoaded) {
            break;
          }
          // agglomerateId2 is merged into agglomerateId1 and the frontend currently has at least one of the meshes loaded.
          // Outdate agglomerateId1 and agglomerateId2. Only agglomerateId1 needs to be reloaded however.
          // Track outdated and updated agglomerateIds to refresh after applying updates.
          addToSetMap(meshIdsToRemovePerLayer, actionTracingId, agglomerateId1);
          addToSetMap(meshIdsToRemovePerLayer, actionTracingId, agglomerateId2);
          // The merged mesh keeps agglomerateId1 (the source), so it should inherit the source's
          // opacity and visibility. Fall back to the target's mesh in case only the target mesh was
          // loaded.
          const mergedMeshDisplayProps: PreservedMeshDisplayProps = yield* select((state) => {
            const meshInfo =
              getMeshInfoForSegment(
                state,
                state.flycam.additionalCoordinates,
                actionTracingId,
                agglomerateId1,
              ) ??
              getMeshInfoForSegment(
                state,
                state.flycam.additionalCoordinates,
                actionTracingId,
                agglomerateId2,
              );
            return { opacity: meshInfo?.opacity, isVisible: meshInfo?.isVisible };
          });
          // Only agglomerateId1 needs to be reloaded; record it with the props to inherit.
          recordMeshToLoad(actionTracingId, agglomerateId1, mergedMeshDisplayProps);
          // Drop any previously queued reload of agglomerateId2 as it was merged into agglomerateId1.
          meshesToLoadPerLayer.get(actionTracingId)?.delete(agglomerateId2);
          break;
        }
        case "splitAgglomerate": {
          // If the changes are done by the local user, no need to do the partial refreshing of the mapping,
          // as this is done by the proofreading saga itself after saving the split actions.
          // Moreover, as the split actions are still needed to be saved after tryToIncorporateActions is finished,
          // the backend and thus a refresh within tryToIncorporateActions wouldn't yet know about the split actions and
          // thus reloading the mapping here would yield false results.
          if (areUnsavedChangesOfUser) {
            break;
          }
          // Note that a "normal" split typically contains multiple splitAgglomerate
          // actions (each action merely removes an edge in the graph).
          const { segmentId1, segmentId2, agglomerateId, actionTracingId } = action.value;
          // segmentId1 keeps agglomerateId, segmentId2 gets a new agglomerate id. We re-request
          // both from the tracingstore (the new id cannot be known locally), each tagged with the
          // old agglomerate id they belonged to. As the split could have happened between segments
          // not loaded in this client, we need to reload in case any segment of the agglomerate is
          // loaded and cannot guess the expected result without asking the backend.
          if (segmentId1 == null || segmentId2 == null || agglomerateId == null) {
            // Current proofreading actions always set these props, so this should never happen.
            throw new Error(
              `Cannot apply splitAgglomerate action: segmentId1, segmentId2 and agglomerateId must be set. Got ${JSON.stringify(
                action.value,
              )}`,
            );
          }
          addToNestedMap(
            splitSegmentIdToOldAgglomeratePerLayer,
            actionTracingId,
            segmentId1,
            agglomerateId,
          );
          addToNestedMap(
            splitSegmentIdToOldAgglomeratePerLayer,
            actionTracingId,
            segmentId2,
            agglomerateId,
          );
          break;
        }

        case "updateMappingName": {
          const { actionTracingId, mappingName, isEditable, isLocked } = action.value;
          let mappingType;
          if (mappingName) {
            let volumeDataLayer = yield* select((state) =>
              getSegmentationLayerByName(state.dataset, actionTracingId),
            );
            // Load mappings if needed and enforce reloading if mapping is editable
            // to ensure the new mapping is available in the store data.
            if (
              volumeDataLayer.mappings == null ||
              volumeDataLayer.agglomerates == null ||
              isEditable
            ) {
              const setMappingsChannel =
                yield* actionChannel<SetLayerMappingsAction>("SET_LAYER_MAPPINGS");
              yield* put(ensureLayerMappingsAreLoadedAction(actionTracingId));
              yield* take(setMappingsChannel);
            }
            mappingType =
              (volumeDataLayer.agglomerates ?? []).indexOf(mappingName) >= 0
                ? ("HDF5" as const)
                : ("JSON" as const);
          }
          yield* put(setMappingAction(actionTracingId, mappingName, mappingType, true));
          const volume = yield* select((state) =>
            getVolumeTracingById(state.annotation, actionTracingId),
          );
          if (!volume.hasEditableMapping && isEditable) {
            yield* put(setHasEditableMappingAction(actionTracingId));
          }
          if (!volume.mappingIsLocked && isLocked) {
            yield* put(setMappingIsLockedAction(actionTracingId));
          }
          break;
        }
        /*
         * Currently NOT supported:
         */
        // TODO (#9052): These actions should be supported if applied from own save queue!

        // High-level annotation specific
        case "addLayerToAnnotation":
        case "addSegmentIndex":
        case "createTracing":
        case "deleteLayerFromAnnotation":
        case "importVolumeTracing":
        case "revertToVersion":
        case "updateLayerMetadata":
        case "updateMetadataOfAnnotation":

        // Volume
        case "removeFallbackLayer":

        // Legacy! The following actions are legacy actions and don't
        // need to be supported.
        case "mergeTree":
        case "updateSegment":
        case "updateSkeletonTracing":
        case "updateVolumeTracing":
        case "updateUserBoundingBoxesInSkeletonTracing":
        case "updateSegmentGroups":
        case "updateUserBoundingBoxesInVolumeTracing": {
          console.error("Cannot apply action", action.name);
          yield* call(finalize);
          return FailedIncorporateActionsReturnValue;
        }
        default: {
          action satisfies never;
        }
      }
    }
    yield* put(setVersionNumberAction(actionBatch.version));
    for (const [
      tracingId,
      splitSegmentIdToOldAgglomerate,
    ] of splitSegmentIdToOldAgglomeratePerLayer.entries()) {
      if (splitSegmentIdToOldAgglomerate && splitSegmentIdToOldAgglomerate.size > 0) {
        const activeMapping = yield* select(
          (store) => store.temporaryConfiguration.activeMappingByLayer[tracingId],
        );
        const splitMappingInfo = yield* splitAgglomeratesInMapping(
          activeMapping,
          splitSegmentIdToOldAgglomerate,
          tracingId,
          actionBatch.version,
          false,
        );

        if (splitMappingInfo == null) {
          const message =
            "Failed to apply an agglomerate split action from another user. Please refresh the page to resync.";
          console.error(message);
          Toast.error(message);
          return FailedIncorporateActionsReturnValue;
        }
        const {
          mappingWithSplitApplied,
          oldAgglomerateIds,
          newAgglomerateIds,
          newToOldAgglomerateIds,
        } = splitMappingInfo;

        yield* put(
          setMappingDataAction(
            tracingId,
            mappingWithSplitApplied,
            false, // Upon finishing the forwarding of missing backend actions the
            // finishedApplyingMissingUpdatesAction action takes care of storing the
            // newest info in RebaseRelevantAnnotationState after the backend updates are applied.
          ),
        );
        const loadedMeshes = yield* select((state) => getAllLoadedMeshes(state, tracingId));
        const loadedMeshesOfSplitAction = loadedMeshes.intersection(oldAgglomerateIds);
        if (loadedMeshesOfSplitAction.size > 0) {
          // Capture the opacity and visibility of the original agglomerates before their meshes are
          // removed, so each split-off agglomerate can inherit the properties of the agglomerate it
          // came from.
          const additionalCoordinates = yield* select(
            (state) => state.flycam.additionalCoordinates,
          );
          const displayPropsByOldAgglomerateId = yield* call(
            getMeshDisplayPropsByOldAgglomerateId,
            tracingId,
            oldAgglomerateIds,
            additionalCoordinates,
          );
          oldAgglomerateIds.forEach((oldAggloId) => {
            addToSetMap(meshIdsToRemovePerLayer, tracingId, oldAggloId);
          });
          newAgglomerateIds.forEach((newAggloId) => {
            const oldAggloId = newToOldAgglomerateIds.get(newAggloId);
            const displayProps =
              (oldAggloId != null ? displayPropsByOldAgglomerateId.get(oldAggloId) : undefined) ??
              {};
            recordMeshToLoad(tracingId, newAggloId, displayProps);
          });
        }
      }
    }
  }

  yield* call(finalize);
  return {
    success: true,
    artifactInfos: { meshIdsToRemovePerLayer, meshesToLoadPerLayer },
  };
}

// Should be called with spawn to not block the rebasing as this is done detached afterwards.
function* resolveApplyingUpdateArtifacts(artifactInfos: ApplyingUpdateArtifacts) {
  const activeVolumeTracingId = (yield* select(getVisibleSegmentationLayer))?.tracingId;
  if (!activeVolumeTracingId) {
    return;
  }
  // The opacities to apply to the reloaded meshes were already gathered while applying the
  // update actions (see meshesToLoadPerLayer), i.e. before the original meshes are removed below.
  yield* call(removeOutdatedMeshes, artifactInfos.meshIdsToRemovePerLayer);
  yield* spawnUntilCanceled(reloadMeshes, artifactInfos.meshesToLoadPerLayer);
}

function* removeOutdatedMeshes(
  meshIdsToRemovePerLayer: ApplyingUpdateArtifacts["meshIdsToRemovePerLayer"],
) {
  // Remove all outdated meshes.
  for (const [tracingId, meshIdsToRemove] of meshIdsToRemovePerLayer.entries()) {
    for (const aggloId of meshIdsToRemove) {
      yield* put(removeMeshAction(tracingId, Number(aggloId)));
    }
  }
}

// Potentially waits until saving is done. Thus, !must be called with spawn!.
function* reloadMeshes(meshesToReloadPerLayer: ApplyingUpdateArtifacts["meshesToLoadPerLayer"]) {
  // First wait in case an operation is running (e.g. proofreading) until it finishes.
  yield call(waitUntilNoActiveOperations);
  const refreshAffectedMeshesEffects = [];
  for (const [tracingId, displayPropsByAgglomerateId] of meshesToReloadPerLayer.entries()) {
    const refreshList: Array<{
      newAgglomerateId: number;
      nodePosition: Vector3;
      opacity?: number;
      isVisible?: boolean;
    }> = [];
    const { hasSegmentIndex } = yield* select((state) =>
      getVolumeTracingById(state.annotation, tracingId),
    );
    const segments = yield* select((state) => getSegmentsForLayer(state, tracingId));

    for (const [agglomerateId, displayProps] of displayPropsByAgglomerateId) {
      const segment = segments.getNullable(agglomerateId);
      // Only load meshes for segments still present.
      if (segment && (segment?.anchorPosition || hasSegmentIndex)) {
        refreshList.push({
          newAgglomerateId: agglomerateId,
          // If the annotation has a segment index, the seed position for the mesh generation is ignored. In that case we can simply use [0, 0, 0].
          nodePosition: segment?.anchorPosition ?? [0, 0, 0],
          opacity: displayProps.opacity,
          isVisible: displayProps.isVisible,
        });
      }
    }
    refreshAffectedMeshesEffects.push(call(refreshAffectedMeshes, tracingId, refreshList));
  }
  yield* all(refreshAffectedMeshesEffects);
}

export default [setupSavingToServer, watchForNewerAnnotationVersion];
