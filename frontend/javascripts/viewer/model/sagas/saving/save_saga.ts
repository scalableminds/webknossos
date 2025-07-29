import { getUpdateActionLog } from "admin/rest_api";
import ErrorHandling from "libs/error_handling";
import Toast from "libs/toast";
import { ColoredLogger, sleep } from "libs/utils";
import _ from "lodash";
import { buffers } from "redux-saga";
import { actionChannel, call, flush, fork, put, race, takeEvery } from "typed-redux-saga";
import type { APIUpdateActionBatch } from "types/api_types";
import { getLayerByName, getMappingInfo } from "viewer/model/accessors/dataset_accessor";
import {
  type EnsureHasNewestVersionAction,
  setVersionNumberAction,
} from "viewer/model/actions/save_actions";
import { applySkeletonUpdateActionsFromServerAction } from "viewer/model/actions/skeletontracing_actions";
import { applyVolumeUpdateActionsFromServerAction } from "viewer/model/actions/volumetracing_actions";
import { globalPositionToBucketPositionWithMag } from "viewer/model/helpers/position_converter";
import type { Saga } from "viewer/model/sagas/effect-generators";
import { select, take } from "viewer/model/sagas/effect-generators";
import { ensureWkReady } from "viewer/model/sagas/ready_sagas";
import { Model } from "viewer/singletons";
import type { SkeletonTracing, VolumeTracing } from "viewer/store";
import { takeEveryWithBatchActionSupport } from "../saga_helpers";
import { clearActiveMapping, updateLocalHdf5Mapping } from "../volume/mapping_saga";
import { pushSaveQueueAsync } from "./save_queue_draining";
import { setupSavingForAnnotation, setupSavingForTracingType } from "./save_queue_filling";

export function* setupSavingToServer(): Saga<void> {
  // This saga continuously drains the save queue by sending its content to the server.
  yield* fork(pushSaveQueueAsync);
  // The following sagas are responsible for filling the save queue with the update actions.
  yield* takeEvery("INITIALIZE_ANNOTATION_WITH_TRACINGS", setupSavingForAnnotation);
  yield* takeEveryWithBatchActionSupport("INITIALIZE_SKELETONTRACING", setupSavingForTracingType);
  yield* takeEveryWithBatchActionSupport("INITIALIZE_VOLUMETRACING", setupSavingForTracingType);
}

// todop: restore to 10
const VERSION_POLL_INTERVAL_COLLAB = 20 * 1000;
const VERSION_POLL_INTERVAL_READ_ONLY = 60 * 1000;
const VERSION_POLL_INTERVAL_SINGLE_EDITOR = 30 * 1000;

function* watchForSaveConflicts(): Saga<void> {
  function* checkForAndTryToIncorporateNewVersion(): Saga<boolean> {
    /*
     * Checks whether there is a newer version on the server. If so,
     * the saga tries to also update the current annotation to the newest
     * state.
     * If the update is not possible, the user will be notified that a newer
     * version exists on the server. In that case, true will be returned (`didAskUserToRefreshPage`).
     */
    const allowSave = yield* select(
      (state) =>
        state.annotation.restrictions.allowSave && state.annotation.isUpdatingCurrentlyAllowed,
    );

    // todop
    if (false && allowSave) {
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

    const maybeSkeletonTracing = yield* select((state) => state.annotation.skeleton);
    const volumeTracings = yield* select((state) => state.annotation.volumes);
    const tracingStoreUrl = yield* select((state) => state.annotation.tracingStore.url);
    const annotationId = yield* select((state) => state.annotation.annotationId);

    const tracings: Array<SkeletonTracing | VolumeTracing> = _.compact([
      ...volumeTracings,
      maybeSkeletonTracing,
    ]);

    if (tracings.length === 0) {
      return false;
    }

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
      true,
    );

    const toastKey = "save_conflicts_warning";
    if (newerActions.length > 0) {
      try {
        if ((yield* tryToIncorporateActions(newerActions)).success) {
          return false;
        }
      } catch (exc) {
        // Afterwards, the user will be asked to reload the page.
        console.error("Error during application of update actions", exc);
      }

      const saveQueue = yield* select((state) => state.save.queue);

      let msg = "";
      if (!allowSave) {
        msg =
          "A newer version of this annotation was found on the server. Reload the page to see the newest changes.";
      } else if (saveQueue.length > 0) {
        msg =
          "A newer version of this annotation was found on the server. Your current changes to this annotation cannot be saved anymore.";
      } else {
        msg =
          "A newer version of this annotation was found on the server. Please reload the page to see the newer version. Otherwise, changes to the annotation cannot be saved anymore.";
      }
      Toast.warning(msg, {
        sticky: true,
        key: toastKey,
      });
      return true;
    } else {
      Toast.close(toastKey);
    }
    return false;
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

  yield* call(ensureWkReady);

  const channel = yield actionChannel(
    ["ENSURE_HAS_NEWEST_VERSION"],
    // todop: if multiple actions are sent to this buffer (without consumption inbetween),
    // we only want to poll the newest version once. This is why the current implementation
    // uses a sliding buffer of size 1. However, this means that dropped actions won't get
    // their callback's notified. This is a problem and could lead to infinite waiting.
    buffers.expanding<EnsureHasNewestVersionAction>(1),
  );

  while (true) {
    const interval = yield* call(getPollInterval);
    let { ensureHasNewestVersion } = yield* race({
      sleep: call(sleep, interval),
      ensureHasNewestVersion: take(channel),
    });
    if (yield* select((state) => state.uiInformation.showVersionRestore)) {
      continue;
    }
    try {
      const didAskUserToRefreshPage = yield* call(checkForAndTryToIncorporateNewVersion);
      if (didAskUserToRefreshPage) {
        // The user was already notified about the current annotation being outdated.
        // There is not much else we can do now. Sleep for 5 minutes.
        yield* call(sleep, 5 * 60 * 1000);
      } else {
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
    } catch (exception) {
      // If the version check fails for some reason, we don't want to crash the entire
      // saga.
      console.warn(exception);
      // @ts-ignore
      ErrorHandling.notify(exception);
      Toast.error(
        "An unrecoverable error occurred while synchronizing this annotation. Please refresh the page.",
      );
      // A hard error was thrown. Terminate this saga.
      break;
    }
  }
}

export function* tryToIncorporateActions(
  newerActions: APIUpdateActionBatch[],
): Saga<{ success: boolean }> {
  // After all actions were incorporated, volume buckets and hdf5 mappings
  // are reloaded (if they exist and necessary). This is done as a
  // "finalization step", because it requires that the newest version is set
  // in the store annotation. Also, it only needs to happen once (instead of
  // per action).
  const updateLocalHdf5FunctionByTracing: Record<string, () => unknown> = {};
  const refreshLayerFunctionByTracing: Record<string, () => unknown> = {};
  function* finalize() {
    for (const fn of Object.values(updateLocalHdf5FunctionByTracing).concat(
      Object.values(refreshLayerFunctionByTracing),
    )) {
      yield* call(fn);
    }
  }
  for (const actionBatch of newerActions) {
    for (const action of actionBatch.value) {
      switch (action.name) {
        /////////////
        // Updates to user-specific state can be ignored:
        //   Camera
        case "updateCamera":
        case "updateTdCamera":
        //   Active items
        case "updateActiveNode":
        case "updateActiveSegmentId":
        //   Visibilities
        case "updateTreeVisibility":
        case "updateTreeGroupVisibility":
        case "updateSegmentVisibility":
        case "updateSegmentGroupVisibility":
        case "updateUserBoundingBoxVisibilityInSkeletonTracing":
        case "updateUserBoundingBoxVisibilityInVolumeTracing":
        //   Group expansion
        case "updateTreeGroupsExpandedState":
        case "updateSegmentGroupsExpandedState": {
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
        case "updateSegment":
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
          ColoredLogger.logBlue("Incorporating mergeAgglomerate");
          const activeMapping = yield* select(
            (store) =>
              store.temporaryConfiguration.activeMappingByLayer[action.value.actionTracingId],
          );
          // todop: segmentId1 and segmentId2 might not exist in the local mapping. this does not
          // mean that the action can be ignored, though, because the agglomerates themselves might
          // exist. we need to map the ids and find out whether these exist in the mapping.
          // yield* call(
          //   updateMappingWithMerge,
          //   action.value.actionTracingId,
          //   activeMapping,
          //   action.value.segmentId1,
          //   action.value.segmentId2,
          // );
          const layerName = action.value.actionTracingId;
          const mappingInfo = yield* select((state) =>
            getMappingInfo(state.temporaryConfiguration.activeMappingByLayer, layerName),
          );
          const dataset = yield* select((state) => state.dataset);
          const layerInfo = getLayerByName(dataset, layerName);
          const { mappingName } = mappingInfo;

          if (mappingName == null) {
            throw new Error(
              "Could not apply splitAgglomerate because no active mapping was found.",
            );
          }
          updateLocalHdf5FunctionByTracing[layerName] = function* () {
            console.log("clearing and refreshing mapping because of split/merge action");
            yield* call(clearActiveMapping, action.value.actionTracingId, activeMapping);
            yield* call(updateLocalHdf5Mapping, layerName, layerInfo, mappingName);
          };
          break;
        }
        case "splitAgglomerate": {
          // todop: doublecheck that this is respected properly:
          // Note that a "normal" split typically contains multiple splitAgglomerate
          // actions (each action merely removes an edge in the graph).
          const activeMapping = yield* select(
            (store) =>
              store.temporaryConfiguration.activeMappingByLayer[action.value.actionTracingId],
          );
          // yield* call(
          //   removeAgglomerateFromActiveMapping,
          //   action.value.actionTracingId,
          //   activeMapping,
          //   /* todop:
          //    * segmentId1 was split from segmentId2. This means both used to map to the same agglomerateId.
          //    * This UA should "invalidate" the current equivalence class to which segmentId1 and segmentId2
          //    * belong. All members of that equivalence class should be removed from the active mapping
          //    * and then re-fetched.
          //    * If our current mapping contains one (or both) of the segmentIds, we can look up the mapped value
          //    * and then clear the mapping accordingly (this is important because the local mapping might have diverged
          //    * from the mapping stored on the server; therefore, even if the UA would also encode the mapped value,
          //    * that wouldn't be sufficient).
          //    * However, it might be that none of the segmentIds were fetched yet. In that case, there are two options:
          //    *   1) the entire equivalence class is unknown to the frontend. Nothing needs to be done now.
          //    *   2) the equivalence class is known, but the segmentIds from the UA are not known. In that case
          //    *      we still need to find out to which id the segmentIds used to map.
          //    *      This can be done by asking the server. For the request we should pass the version that existed
          //    *      right before the update action (because that is the version where the two segments were merged.)
          //    */

          //   action.value.agglomerateId,
          // );

          const layerName = action.value.actionTracingId;

          const mappingInfo = yield* select((state) =>
            getMappingInfo(state.temporaryConfiguration.activeMappingByLayer, layerName),
          );
          const { mappingName } = mappingInfo;

          if (mappingName == null) {
            throw new Error(
              "Could not apply splitAgglomerate because no active mapping was found.",
            );
          }

          const dataset = yield* select((state) => state.dataset);
          const layerInfo = getLayerByName(dataset, layerName);

          updateLocalHdf5FunctionByTracing[layerName] = function* () {
            console.log("clearing and refreshing mapping because of split/merge action");
            yield* call(clearActiveMapping, action.value.actionTracingId, activeMapping);
            yield* call(updateLocalHdf5Mapping, layerName, layerInfo, mappingName);
          };

          break;
        }

        /*
         * Currently NOT supported:
         */

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
        case "updateSkeletonTracing":
        case "updateVolumeTracing":
        case "updateUserBoundingBoxesInSkeletonTracing":
        case "updateUserBoundingBoxesInVolumeTracing": {
          console.log("Cannot apply action", action.name);
          yield* call(finalize);
          return { success: false };
        }
        default: {
          action satisfies never;
        }
      }
    }
    ColoredLogger.logGreen("Setting local version to", actionBatch.version);
    yield* put(setVersionNumberAction(actionBatch.version));
  }
  yield* call(finalize);
  return { success: true };
}

export default [setupSavingToServer, watchForSaveConflicts];
