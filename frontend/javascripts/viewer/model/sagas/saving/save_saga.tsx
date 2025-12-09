import { getUpdateActionLog } from "admin/rest_api";
import features from "features";
import ErrorHandling from "libs/error_handling";
import Toast from "libs/toast";
import { ColoredLogger, sleep } from "libs/utils";
import _ from "lodash";
import { type Channel, buffers } from "redux-saga";
import { actionChannel, call, delay, flush, fork, put, race, takeEvery } from "typed-redux-saga";
import type { APIUpdateActionBatch } from "types/api_types";
import { WkDevFlags } from "viewer/api/wk_dev";
import { SagaIdentifier } from "viewer/constants";
import type { Action } from "viewer/model/actions/actions";
import { showManyBucketUpdatesWarningAction } from "viewer/model/actions/annotation_actions";
import {
  type EnsureHasNewestVersionAction,
  type NotifyAboutUpdatedBucketsAction,
  dispatchEnsureTracingsWereDiffedToSaveQueueAction,
  finishedApplyingMissingUpdatesAction,
  finishedRebaseAction,
  prepareRebaseAction,
  setVersionNumberAction,
} from "viewer/model/actions/save_actions";
import { setMappingAction } from "viewer/model/actions/settings_actions";
import { applySkeletonUpdateActionsFromServerAction } from "viewer/model/actions/skeletontracing_actions";
import { applyVolumeUpdateActionsFromServerAction } from "viewer/model/actions/volumetracing_actions";
import { globalPositionToBucketPositionWithMag } from "viewer/model/helpers/position_converter";
import type { Saga } from "viewer/model/sagas/effect-generators";
import { select, take } from "viewer/model/sagas/effect-generators";
import { ensureWkInitialized } from "viewer/model/sagas/ready_sagas";
import { Model, Store } from "viewer/singletons";
import type { NumberLike, SkeletonTracing, VolumeTracing } from "viewer/store";
import {
  enforceExecutionAsBusyBlockingUnlessAllowed,
  takeEveryWithBatchActionSupport,
} from "../saga_helpers";
import { splitAgglomerateInMapping, updateMappingWithMerge } from "../volume/proofread_saga";
import {
  saveQueueEntriesToServerUpdateActionBatches,
  updateSaveQueueEntriesToStateAfterRebase,
} from "./rebasing_helpers_sagas";
import { pushSaveQueueAsync } from "./save_queue_draining_saga";
import { setupSavingForAnnotation, setupSavingForTracingType } from "./save_queue_filling_saga";

export function* setupSavingToServer(): Saga<void> {
  // This saga continuously drains the save queue by sending its content to the server.
  yield* fork(pushSaveQueueAsync);
  // The following sagas are responsible for filling the save queue with the update actions.
  yield* takeEvery("INITIALIZE_ANNOTATION_WITH_TRACINGS", setupSavingForAnnotation);
  yield* takeEveryWithBatchActionSupport("INITIALIZE_SKELETONTRACING", setupSavingForTracingType);
  yield* takeEveryWithBatchActionSupport("INITIALIZE_VOLUMETRACING", setupSavingForTracingType);
  yield* takeEvery("WK_READY", watchForNumberOfBucketsInSaveQueue);
}

const VERSION_POLL_INTERVAL_COLLAB = 10 * 1000;
const VERSION_POLL_INTERVAL_READ_ONLY = 5 * 1000;
const VERSION_POLL_INTERVAL_SINGLE_EDITOR = 30 * 1000;
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
    const sumOfBuckets = _.sum(currentBucketCounts);
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

  const othersMayEdit = yield* select((state) => state.annotation.othersMayEdit);
  if (othersMayEdit) {
    // Other users may edit the annotation.
    return VERSION_POLL_INTERVAL_COLLAB;
  }

  // The current user is the only one who can edit the annotation.
  return VERSION_POLL_INTERVAL_SINGLE_EDITOR;
}

function* shouldCheckForNewerAnnotationVersions(): Saga<boolean> {
  const allowSave = yield* select(
    (state) =>
      state.annotation.restrictions.allowSave && state.annotation.isUpdatingCurrentlyAllowed,
  );
  const othersMayEdit = yield* select((state) => state.annotation.othersMayEdit);

  const userCanSaveAndNoCollab = allowSave && !othersMayEdit;
  const userCanSaveAndNoLiveCollab = allowSave && !WkDevFlags.liveCollab;
  if (userCanSaveAndNoCollab || userCanSaveAndNoLiveCollab) {
    // The active user is currently the only one that is allowed to mutate the annotation.
    // Since we only acquire the mutex upon page load, there shouldn't be any unseen updates
    // between the page load and this check here.
    // A race condition where
    //   1) another user saves version X
    //   2) we load the annotation but only get see version X - 1 (this is the race)
    //   3) we acquire a mutex
    // should not occur, because there is a grace period for which the mutex has to be free until it can
    // be acquired again (see annotation.mutex.expiryTime in application.conf).
    // The downside of an early return here is that we won't be able to warn the user early
    // if the user opened the annotation in two tabs and mutated it there.
    // However,
    //   a) this scenario is pretty rare and the worst case is that they get a 409 error
    //      during saving and
    //   b) checking for newer versions when the active user may update the annotation introduces
    //      a race condition between this saga and the actual save saga. Synchronizing these sagas
    //      would be possible, but would add further complexity to the mission critical save saga.
    return false;
  }

  // Check for tracings which could need updating
  const maybeSkeletonTracing = yield* select((state) => state.annotation.skeleton);
  const volumeTracings = yield* select((state) => state.annotation.volumes);

  const tracings: Array<SkeletonTracing | VolumeTracing> = _.compact([
    ...volumeTracings,
    maybeSkeletonTracing,
  ]);

  if (tracings.length === 0) {
    // If there are not tracings that could need updates, no update fetching is needed.
    return false;
  }
  return true;
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

function* applyNewestMissingUpdateActions(
  actions: APIUpdateActionBatch[],
): Saga<{ successful: boolean }> {
  if (actions.length === 0) {
    Toast.close(SAVING_CONFLICT_TOAST_KEY);
    return { successful: true };
  }
  const allowSave = yield* select(
    (state) =>
      state.annotation.restrictions.allowSave && state.annotation.isUpdatingCurrentlyAllowed,
  );
  try {
    if ((yield* tryToIncorporateActions(actions, false)).success) {
      // Updates the annotation state used for future rebase operation the the current state with the missingUpdateActions applied.
      yield* put(finishedApplyingMissingUpdatesAction());
      return { successful: true };
    }
  } catch (exc) {
    // Afterwards, the user will be asked to reload the page.
    console.error("Error during application of update actions", exc);
  }

  const hasPendingUpdates = (yield* select((state) => state.save.queue)).length > 0;

  let msg = "";
  if (!allowSave) {
    msg =
      "A newer version of this annotation was found on the server. Reload the page to see the newest changes.";
  } else if (hasPendingUpdates) {
    msg =
      "A newer version of this annotation was found on the server. Your current changes to this annotation cannot be saved anymore. Please reload.";
  } else {
    msg =
      "A newer version of this annotation was found on the server. Please reload the page to see the newer version. Otherwise, changes to the annotation cannot be saved anymore.";
  }
  Toast.warning(msg, {
    sticky: true,
    key: SAVING_CONFLICT_TOAST_KEY,
  });
  return { successful: false };
}

function* diffTracingsAndPrepareRebase(): Saga<void> {
  const annotation = yield* select((state) => state.annotation);
  yield dispatchEnsureTracingsWereDiffedToSaveQueueAction(Store.dispatch, annotation);
  yield* put(prepareRebaseAction());
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

function* reapplyUpdateActionsFromSaveQueue(): Saga<{ successful: boolean }> {
  const saveQueueEntries = yield* select((state) => state.save.queue);
  const currentVersion = yield* select((state) => state.annotation.version);
  if (saveQueueEntries.length === 0) {
    return { successful: true };
  }
  // Potentially update save queue entries to state after applying missing backend actions.
  // Properties like unmapped segment ids of proofreading actions might have changed and are updated here.
  // updateSaveQueueEntriesToStateAfterRebase might do some additional needed backend requests.
  const { success, updatedSaveQueue } = yield* call(updateSaveQueueEntriesToStateAfterRebase);
  if (success) {
    const saveQueueAsServerUpdateActionBatches = saveQueueEntriesToServerUpdateActionBatches(
      updatedSaveQueue,
      currentVersion,
    );
    const successfullyAppliedSaveQueueUpdates = (yield* tryToIncorporateActions(
      saveQueueAsServerUpdateActionBatches,
      true,
    )).success;
    if (successfullyAppliedSaveQueueUpdates) {
      yield* put(finishedRebaseAction());
      return { successful: true };
    }
  }
  return { successful: false };
}

type RebasingSuccessInfo = { successful: boolean; shouldTerminate: boolean };
function* performRebasingIfNecessary(): Saga<RebasingSuccessInfo> {
  const othersMayEdit = yield* select((state) => state.annotation.othersMayEdit);
  const missingUpdateActions = yield* call(fetchNewestMissingUpdateActions);
  // saveQueueEntries should not change during performRebasing saga. When liveCollab is enabled, this is enforced via busy blocking.
  // When liveCollab is disabled, this code typically runs in read-only mode where the save queue is empty.
  const saveQueueEntries = yield* select((state) => state.save.queue);

  // Side note: In a scenario where a user has an annotation open that they are not allowed to edit but another user is actively editing
  // This code will notice that there are missingUpdateActions and apply them. This should not trigger a full rebase and should
  // be ensured because not allowed to edit means the save queue would be empty. Thus no needsRebasing = true.
  const needsRebasing =
    WkDevFlags.liveCollab &&
    othersMayEdit &&
    missingUpdateActions.length > 0 &&
    saveQueueEntries.length > 0;
  if (needsRebasing) {
    yield* call(diffTracingsAndPrepareRebase);
  }

  // ColoredLogger.logRed("needsRebasing", needsRebasing);

  try {
    // ColoredLogger.logRed("apply from server", missingUpdateActions);
    if (missingUpdateActions.length > 0) {
      const { successful } = yield* call(applyNewestMissingUpdateActions, missingUpdateActions);
      if (!successful) {
        return { successful: false, shouldTerminate: false };
      }
    }
    if (needsRebasing) {
      // ColoredLogger.logRed("Reapply from save queue");
      // If no rebasing was necessary, the pending update actions in the save queue must not be reapplied.
      const { successful } = yield* call(reapplyUpdateActionsFromSaveQueue);
      if (!successful) {
        return { successful: false, shouldTerminate: false };
      }
    }
    return { successful: true, shouldTerminate: false };
  } catch (exception) {
    // If the rebasing fails for some reason, we don't want to crash the entire
    // saga.
    console.error("in save saga, got exception, terminating ...");
    console.warn(exception);
    // @ts-ignore
    ErrorHandling.notify(exception);
    Toast.error(
      "An unrecoverable error occurred while synchronizing this annotation. Please refresh the page.",
    );
    // A hard error was thrown. Terminate this saga.
    return { successful: false, shouldTerminate: true };
  }
}
export const REBASING_BUSY_BLOCK_REASON = "Syncing Annotation";

function* watchForNewerAnnotationVersion(): Saga<void> {
  yield* call(ensureWkInitialized);

  const channel = yield* actionChannel(
    ["ENSURE_HAS_NEWEST_VERSION"],
    // If multiple actions are sent to this buffer (without consumption inbetween),
    // we want to flush them all at once. This is achieved by using an expanding buffer
    // and flushing all events and calling their callbacks every time an ensureHasNewestVersion
    // action is resolved.
    buffers.expanding<EnsureHasNewestVersionAction>(1),
  );
  while (true) {
    // Use this annotation for rebasing the incoming update actions.
    const interval = yield* call(getPollInterval);
    let { ensureHasNewestVersion } = yield* race({
      sleep: call(sleep, interval),
      ensureHasNewestVersion: take(channel),
    });
    const shouldCheckForUpdatesOnServer = yield* call(shouldCheckForNewerAnnotationVersions);
    const isVersionRestoreActive = yield* select((state) => state.uiInformation.showVersionRestore);
    if (!shouldCheckForUpdatesOnServer || isVersionRestoreActive) {
      continue;
    }
    // In live collab mode, the user could update the annotation concurrently with rebasing.
    // Therefore, acquire the busy lock to prevent user update actions from interfering with the rebase.
    // In non-live-collab mode (typically read-only polling), skip busy blocking to avoid freezing the UI.
    const isUpdatingCurrentlyAllowed = yield* select(
      (state) => state.annotation.isUpdatingCurrentlyAllowed,
    );
    const guardAsBlocking = WkDevFlags.liveCollab && isUpdatingCurrentlyAllowed;
    const { successful, shouldTerminate } = guardAsBlocking
      ? yield* call(
          // Ensuring wk is in busy state while rebasing so no user update actions can interfere potential syncing with the backend.
          enforceExecutionAsBusyBlockingUnlessAllowed<RebasingSuccessInfo>,
          performRebasingIfNecessary,
          REBASING_BUSY_BLOCK_REASON,
          // In case another saga is already blocking the busy state, check whether the save saga is still allowed to run now or should wait for the busy flag.
          SagaIdentifier.SAVE_SAGA,
        )
      : yield* call(performRebasingIfNecessary);

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
): Saga<{ success: boolean }> {
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
  for (const actionBatch of newerActions) {
    const agglomerateIdsToRefresh = new Set<NumberLike>();
    let volumeTracingIdOfMapping = null;
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
        case "createSegment":
        case "deleteSegment":
        case "updateSegmentPartial":
        case "updateSegmentGroups":
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
            return { success: false };
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
          const { agglomerateId, actionTracingId } = action.value;
          volumeTracingIdOfMapping = actionTracingId;
          if (agglomerateId) {
            // The action already contains the info about what agglomerate was split.
            // As the split could have happened between segments not loaded in this client,
            // we need to reload in case any segment of the agglomerate is loaded and
            // cannot guess the expected result without asking the backend.
            agglomerateIdsToRefresh.add(agglomerateId);
          } else {
            console.log(
              "Cannot apply splitAgglomerate action due to agglomerateId not being provided in the action",
              action.value,
            );
            yield* call(finalize);
            return { success: false };
          }

          break;
        }

        /*
         * Currently NOT supported:
         */
        // TODO: These actions should be supported if applied from own save queue!

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
        case "updateMappingName": // Refactor mapping activation first before implementing this.

        // Legacy! The following actions are legacy actions and don't
        // need to be supported.
        case "mergeTree":
        case "updateSegment":
        case "updateSkeletonTracing":
        case "updateVolumeTracing":
        case "updateUserBoundingBoxesInSkeletonTracing":
        case "updateUserBoundingBoxesInVolumeTracing": {
          console.error("Cannot apply action", action.name);
          yield* call(finalize);
          return { success: false };
        }
        default: {
          action satisfies never;
        }
      }
    }
    yield* put(setVersionNumberAction(actionBatch.version));
    if (agglomerateIdsToRefresh.size > 0 && volumeTracingIdOfMapping) {
      const agglomerateIdToRefresh = agglomerateIdsToRefresh.values().next().value;
      if (agglomerateIdToRefresh == null) {
        continue;
      }
      const activeMapping = yield* select(
        (store) => store.temporaryConfiguration.activeMappingByLayer[volumeTracingIdOfMapping],
      );
      const splitMapping = yield* splitAgglomerateInMapping(
        activeMapping,
        //  TODO: Add 64 bit support
        Number(agglomerateIdToRefresh),
        volumeTracingIdOfMapping,
        actionBatch.version,
      );

      yield* put(
        setMappingAction(
          volumeTracingIdOfMapping,
          activeMapping.mappingName,
          activeMapping.mappingType,
          true, // Might be optimistic. The mapping might not be in in the same state as on the server when reapplying local updates.
          // The finishedApplyingMissingUpdatesAction action takes care of storing the newest info in RebaseRelevantAnnotationState
          // after the backend updates are applied.
          {
            mapping: splitMapping || undefined,
          },
        ),
      );
    }
  }
  yield* call(finalize);
  return { success: true };
}
export default [setupSavingToServer, watchForNewerAnnotationVersion];
