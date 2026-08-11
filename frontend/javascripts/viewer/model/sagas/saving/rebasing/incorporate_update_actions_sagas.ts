import Toast from "libs/toast";
import { addToNestedMap, addToSetMap } from "libs/utils";
import { actionChannel, call, put } from "typed-redux-saga";
import type { APIUpdateActionBatch } from "types/api_types";
import type { LayerNameAsKey } from "types/type_utils";
import { getSegmentationLayerByName } from "viewer/model/accessors/dataset_accessor";
import {
  getAllLoadedMeshes,
  getMeshInfoForSegment,
  getVolumeTracingById,
  isMeshLoaded,
} from "viewer/model/accessors/volumetracing_accessor";
import {
  ensureLayerMappingsAreLoadedAction,
  type SetLayerMappingsAction,
} from "viewer/model/actions/dataset_actions";
import { setVersionNumberAction } from "viewer/model/actions/save_actions";
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
import { Model } from "viewer/singletons";
import {
  splitAgglomeratesInMapping,
  updateMappingWithMerge,
} from "../../volume/proofreading/local_mapping_update_sagas";
import {
  getMeshDisplayPropsByOldAgglomerateId,
  type PreservedMeshDisplayProps,
} from "../../volume/proofreading/segment_and_mesh_refresh_sagas";
import {
  type ApplyingUpdateArtifacts,
  FailedIncorporateActionsReturnValue,
} from "./applying_update_artifacts";

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
  const meshIdsToRemovePerLayer: Map<string, Set<bigint>> = new Map();
  // Maps each layer's agglomerate ids whose meshes should be (re)loaded to the display properties
  // (opacity and visibility) the reloaded mesh should inherit from the agglomerate it originated
  // from (empty if nothing was stored). These must be gathered here while the original meshes still
  // exist; the meshes are only removed later in resolveApplyingUpdateArtifacts.
  const meshesToLoadPerLayer: Map<
    LayerNameAsKey,
    Map<bigint, PreservedMeshDisplayProps>
  > = new Map();
  function recordMeshToLoad(
    tracingId: string,
    agglomerateId: bigint,
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
    const splitSegmentIdToOldAgglomeratePerLayer: Map<string, Map<bigint, bigint>> = new Map();
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
          const { actionTracingId } = action.value;
          if (action.value.agglomerateId1 == null || action.value.agglomerateId2 == null) {
            console.log(
              "Cannot apply mergeAgglomerate action due to agglomerateId1 or agglomerateId2 not being provided in the action",
              action.value,
            );
            yield* call(finalize);
            return FailedIncorporateActionsReturnValue;
          }
          // Legacy persisted actions may still have a plain number here instead of bigint.
          const agglomerateId1 = BigInt(action.value.agglomerateId1);
          const agglomerateId2 = BigInt(action.value.agglomerateId2);
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
