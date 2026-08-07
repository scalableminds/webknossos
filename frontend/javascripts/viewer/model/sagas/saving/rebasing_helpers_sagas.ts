import { getAgglomeratesForSegmentsFromTracingstore } from "admin/rest_api";
import { NumberLikeMapWrapper } from "libs/number_like_map_wrapper";
import omitBy from "lodash-es/omitBy";
import { call, put } from "typed-redux-saga";
import type { AdditionalCoordinate, APIUpdateActionBatch } from "types/api_types";
import type { Vector3 } from "viewer/constants";
import { getAdditionalCoordinatesAsString } from "viewer/model/accessors/flycam_accessor";
import {
  replaceSaveQueueAction,
  setPendingProofreadingOperationInfoAction,
} from "viewer/model/actions/save_actions";
import { setMappingDataAction } from "viewer/model/actions/settings_actions";
import type { Saga } from "viewer/model/sagas/effect_generators";
import { select } from "viewer/model/sagas/effect_generators";
import { api } from "viewer/singletons";
import type {
  ActiveMappingInfo,
  Mapping,
  NumberLikeMap,
  SaveQueueEntry,
  StoreAnnotation,
} from "viewer/store";
import type {
  CreateSegmentUpdateAction,
  DeleteSegmentUpdateAction,
  MergeAgglomerateUpdateAction,
  MergeSegmentItemsUpdateAction,
  ServerUpdateAction,
  SplitAgglomerateUpdateAction,
  UpdateMetadataOfSegmentUpdateAction,
  UpdateSegmentPartialUpdateAction,
  UpdateSegmentVisibilityVolumeAction,
} from "../volume/update_actions";

export function saveQueueEntriesToServerUpdateActionBatches(
  data: Array<SaveQueueEntry>,
  version: number,
) {
  return data.map((entry) => ({
    version,
    value: entry.actions.map(
      (action) =>
        ({
          ...action,
          value: {
            actionTimestamp: 0,
            ...action.value,
          },
        }) as ServerUpdateAction,
    ),
  }));
}

type IdsToReloadPerMappingId = Map<string, Set<number>>;
type AnchorPositionToUnmappedIdByMappingId = Map<string, Map<string, number>>;

function appendToIdsToReloadMapping(
  actionTracingId: string,
  idsToReloadByMappingId: IdsToReloadPerMappingId,
  segmentId2: number,
) {
  if (!idsToReloadByMappingId.has(actionTracingId)) {
    idsToReloadByMappingId.set(actionTracingId, new Set());
  }
  idsToReloadByMappingId.get(actionTracingId)!.add(segmentId2);
}

async function appendIdToReloadFromPositionAsync(
  action: CreateSegmentUpdateAction,
  idsToReloadByMappingId: IdsToReloadPerMappingId,
  anchorPositionToUnmappedIdByMappingId: AnchorPositionToUnmappedIdByMappingId,
) {
  const { actionTracingId, anchorPosition, additionalCoordinates } = action.value;
  if (anchorPosition == null) {
    return;
  }
  const unmappedId = await api.data.getDataValue(
    actionTracingId,
    anchorPosition,
    null,
    additionalCoordinates,
  );
  const anchorPositionKey = segmentPositionToKey(anchorPosition, additionalCoordinates);
  if (!anchorPositionToUnmappedIdByMappingId.has(actionTracingId)) {
    anchorPositionToUnmappedIdByMappingId.set(actionTracingId, new Map());
  }
  anchorPositionToUnmappedIdByMappingId.get(actionTracingId)!.set(anchorPositionKey, unmappedId);
  appendToIdsToReloadMapping(actionTracingId, idsToReloadByMappingId, unmappedId);
}

function segmentPositionToKey(
  anchorPosition: Vector3,
  additionalCoordinates: AdditionalCoordinate[] | null | undefined,
) {
  return `${anchorPosition.join(",")}-${getAdditionalCoordinatesAsString(additionalCoordinates)}`;
}

// Gathers mapped agglomerate ids for unknown but relevant segments to apply the passed save queue entries correctly.
// This is needed in case proofreading was done via mesh interactions whose mapping info is present in the meshes
// but not in the activeMappingByLayer.mapping. Due to incorporating backend updates the agglomerate ids of the
// meshes might be outdated, thus we reload this info and store it in the local mapping to perform the correct merge.
// Returns a list of segment ids to reload for each needed volume / editable tracing id.
function* getAllUnknownSegmentIdsInPendingUpdates(saveQueue: SaveQueueEntry[]): Saga<{
  idsToReloadByMappingId: IdsToReloadPerMappingId;
  anchorPositionToUnmappedIdByMappingId: AnchorPositionToUnmappedIdByMappingId;
}> {
  const activeMappingByLayer = yield* select(
    (store) => store.temporaryConfiguration.activeMappingByLayer,
  );
  const idsToReloadByMappingId = new Map();
  const anchorPositionToUnmappedIdByMappingId: Map<string, Map<string, number>> = new Map();
  const promises = [];
  for (const saveQueueEntry of saveQueue) {
    for (const action of saveQueueEntry.actions) {
      switch (action.name) {
        case "mergeSegmentItems":
        case "mergeAgglomerate":
        case "splitAgglomerate": {
          const { actionTracingId } = action.value;
          const { segmentId1, segmentId2 } = action.value;

          const unwrappedMappingSyncedWithBackend = activeMappingByLayer[actionTracingId]?.mapping;
          if (!unwrappedMappingSyncedWithBackend || segmentId1 == null || segmentId2 == null) {
            continue;
          }

          const mappingSyncedWithBackend = new NumberLikeMapWrapper(
            unwrappedMappingSyncedWithBackend,
          );
          const updatedAgglomerateId1 = mappingSyncedWithBackend.get(segmentId1);
          const updatedAgglomerateId2 = mappingSyncedWithBackend.get(segmentId2);
          if (!updatedAgglomerateId1) {
            appendToIdsToReloadMapping(actionTracingId, idsToReloadByMappingId, segmentId1);
          }
          if (!updatedAgglomerateId2) {
            appendToIdsToReloadMapping(actionTracingId, idsToReloadByMappingId, segmentId2);
          }
          break;
        }
        case "createSegment": {
          promises.push(
            action,
            appendIdToReloadFromPositionAsync(
              action,
              idsToReloadByMappingId,
              anchorPositionToUnmappedIdByMappingId,
            ),
          );
          break;
        }
      }
    }
  }
  yield* call([Promise, Promise.all], promises);
  return { idsToReloadByMappingId, anchorPositionToUnmappedIdByMappingId };
}

// For each passed mapping, reload the segment ids' mapping information and store it in the local mapping.
// Needed after getAllUnknownSegmentIdsInPendingUpdates to load updated mapping info for segment ids of
// mesh interaction proofreading actions to ensure reapplying these actions is done with up-to-date mapping info.
function* addMissingSegmentsToLoadedMappings(
  idsToReloadPerMapping: IdsToReloadPerMappingId,
): Saga<void> {
  const annotationId = yield* select((state) => state.annotation.annotationId);
  const version = yield* select((state) => state.annotation.version);
  const tracingStoreUrl = yield* select((state) => state.annotation.tracingStore.url);
  const activeMappingByLayer = yield* select(
    (store) => store.temporaryConfiguration.activeMappingByLayer,
  );
  for (const volumeTracingId of idsToReloadPerMapping.keys()) {
    const idsToReload = idsToReloadPerMapping.get(volumeTracingId);
    if (idsToReload == null || idsToReload.size === 0) {
      continue;
    }
    const activeMapping = activeMappingByLayer[volumeTracingId];
    // Ask the server to map the segment ids needing reloading. This creates a partial mapping
    // that only contains these ids.
    const mappingWithMissingIds = yield* call(
      getAgglomeratesForSegmentsFromTracingstore,
      tracingStoreUrl,
      volumeTracingId,
      idsToReload,
      annotationId,
      version,
    );
    const mergedMapping = new Map(
      Array.from((activeMapping.mapping ?? new Map()) as NumberLikeMap).concat(
        Array.from(mappingWithMissingIds as NumberLikeMap),
      ),
    );
    yield* put(
      setMappingDataAction(
        volumeTracingId,
        mergedMapping as Mapping,
        // Although this version is stored on the server, the used version to fetch the mapping info might be different
        // from the version stored in RebaseRelevantAnnotationState. Thus, we update RebaseRelevantAnnotationState not via the
        // isVersionStoredOnServer below. Instead the higher level function of the rebasing process take care of updating the
        // RebaseRelevantAnnotationState.
        false,
      ),
    );
  }
}

// During rebasing, the front-end rolls back to the last version that is known to be saved on the server
// (pending update actions are "stashed" by keeping them in the save queue).
// Then, the front-end is forwarded to the newest state known to the server.
// Afterwards, the stashed update actions need to be applied again. However, these update actions
// need to be adapted to the newest state.
// This adaption takes place in the following saga.
//
// For proofreading actions, this saga gathers mapped info for segment ids from proofreading actions
// where the mapping is unknown.
// This happens in case of mesh proofreading actions. To re-apply the user's changes in the rebasing
// up-to-date mapping info is needed for all segments in all proofreading actions. Thus, the missing info
// is first loaded and then the save queue update actions are remapped to update their agglomerate id infos
// to apply them correctly during rebasing. Lastly, the save queue is replaced with the updated save queue entries.
export function* updateSaveQueueEntriesToStateAfterRebase(
  // appliedBackendUpdateActions contains the backend actions that were used to forward the local state
  // during rebase. These actions can be used as additional information to adapt the local, pending
  // save queue entries to the rebase.
  _appliedBackendUpdateActions: APIUpdateActionBatch[],
  annotationBeforeRebase: StoreAnnotation,
): Saga<
  | {
      success: false;
      updatedSaveQueue: undefined;
    }
  | {
      success: true;
      updatedSaveQueue: SaveQueueEntry[];
    }
> {
  const saveQueue = yield* select((state) => state.save.queue);
  const { idsToReloadByMappingId: idsToFetch, anchorPositionToUnmappedIdByMappingId } = yield* call(
    getAllUnknownSegmentIdsInPendingUpdates,
    saveQueue,
  );
  yield* call(addMissingSegmentsToLoadedMappings, idsToFetch);
  const activeMappingByLayer = yield* select(
    (store) => store.temporaryConfiguration.activeMappingByLayer,
  );
  // Reminder: Rebase = Rewind (local actions) + Forward (to newest backend state) + Reapply (local actions)
  const annotationBeforeReapplying = yield* select((state) => state.annotation);

  let success = true;
  const updatedSaveQueue = saveQueue
    .map((saveQueueEntry): SaveQueueEntry | null => {
      const newActions = saveQueueEntry.actions
        .map((action) => {
          switch (action.name) {
            case "mergeAgglomerate":
            case "mergeSegmentItems":
            case "splitAgglomerate": {
              // Merge/split related actions are updated by remapping the super-voxel ids
              // to the most-recent agglomerate ids.
              // This resolves conflicts around concurrent merges/splits.
              const { segmentId1, segmentId2, actionTracingId } = action.value;
              const mappingSyncedWithBackendUnwrapped =
                activeMappingByLayer[actionTracingId]?.mapping;
              if (!mappingSyncedWithBackendUnwrapped) {
                console.error(
                  "Found proofreading action without matching mapping in save queue. This should never happen.",
                  action,
                );
                success = false;
                return null;
              }
              if (segmentId1 == null || segmentId2 == null) {
                console.error(
                  "Found proofreading action without given segmentIds in save queue. This should never happen.",
                  action,
                );
                success = false;
                return null;
              }

              const mappingSyncedWithBackend = new NumberLikeMapWrapper(
                mappingSyncedWithBackendUnwrapped,
              );
              let upToDateAgglomerateId1 = mappingSyncedWithBackend.get(segmentId1);
              let upToDateAgglomerateId2 = mappingSyncedWithBackend.get(segmentId2);
              if (!upToDateAgglomerateId1 || !upToDateAgglomerateId2) {
                console.error(
                  "Found proofreading action without loaded agglomerate ids. This should never occur.",
                  action,
                );
                success = false;
                return null;
              }
              if (action.name === "splitAgglomerate") {
                return {
                  name: action.name,
                  value: {
                    ...action.value,
                    agglomerateId: Number(upToDateAgglomerateId1),
                  },
                } satisfies SplitAgglomerateUpdateAction;
              } else if (action.name === "mergeAgglomerate") {
                return {
                  name: action.name,
                  value: {
                    ...action.value,
                    agglomerateId1: Number(upToDateAgglomerateId1),
                    agglomerateId2: Number(upToDateAgglomerateId2),
                  },
                } satisfies MergeAgglomerateUpdateAction;
              } else if (action.name === "mergeSegmentItems") {
                return {
                  name: action.name,
                  value: {
                    ...action.value,
                    agglomerateId1: Number(upToDateAgglomerateId1),
                    agglomerateId2: Number(upToDateAgglomerateId2),
                  },
                } satisfies MergeSegmentItemsUpdateAction;
              }
            }
            case "createSegment": {
              // createSegment update actions might need to be changed to updateSegmentPartial
              // if another user created that segment in the meantime.
              const { actionTracingId } = action.value;
              const segmentId = getUpToDateSegmentIdViaPosition(
                actionTracingId,
                action.value.id,
                action.value.anchorPosition,
                action.value.additionalCoordinates,
                activeMappingByLayer,
                anchorPositionToUnmappedIdByMappingId,
              );
              const tracing = annotationBeforeReapplying.volumes.find(
                (v) => v.tracingId === actionTracingId,
              );

              const maybeExistingSegment = tracing?.segments.getNullable(segmentId);

              if (!maybeExistingSegment) {
                return action;
              }

              // The local user created a segment, but after rebase the segment already exists
              // (probably because another user also created that segment).
              // Let's only update the properties that are not null.
              const newAction: UpdateSegmentPartialUpdateAction = {
                name: "updateSegmentPartial",
                value: {
                  ...omitBy(action.value, (value) => value == null),
                  actionTracingId: action.value.actionTracingId,
                  id: segmentId,
                },
              };
              return newAction;
            }
            case "updateSegmentVisibility":
            case "updateMetadataOfSegment":
            case "updateSegmentPartial":
            case "deleteSegment": {
              // Updates to segments (including deletions) will be dropped
              // when another user already removed that segment in the meantime.
              const { actionTracingId } = action.value;

              const tracingBeforeRebase = annotationBeforeRebase.volumes.find(
                (v) => v.tracingId === actionTracingId,
              );
              const maybeExistingSegmentBeforeRebase = tracingBeforeRebase?.segments.getNullable(
                action.value.id,
              );

              const segmentId = getUpToDateSegmentIdViaPosition(
                actionTracingId,
                action.value.id,
                maybeExistingSegmentBeforeRebase?.anchorPosition,
                maybeExistingSegmentBeforeRebase?.additionalCoordinates,
                activeMappingByLayer,
                anchorPositionToUnmappedIdByMappingId,
              );

              const tracingBeforeReapplying = annotationBeforeReapplying.volumes.find(
                (v) => v.tracingId === actionTracingId,
              );
              const maybeExistingSegment = tracingBeforeReapplying?.segments.getNullable(segmentId);

              if (!maybeExistingSegment) {
                // Another user removed the segment, causing the current user's update to be lost
                // (which is acceptable).
                return null;
              }

              // Since the update action precisely encodes what changed within the segment,
              // we don't need to adapt the action itself.
              return {
                ...action,
                value: {
                  ...action.value,
                  id: segmentId,
                },
              } as
                | UpdateSegmentVisibilityVolumeAction
                | UpdateMetadataOfSegmentUpdateAction
                | UpdateSegmentPartialUpdateAction
                | DeleteSegmentUpdateAction;
            }

            default:
              return action;
          }
        })
        .filter((a) => a != null);
      if (newActions.length === 0) {
        return null;
      }
      return {
        ...saveQueueEntry,
        actions: newActions,
      };
    })
    .filter((a) => a != null);
  if (success) {
    yield put(replaceSaveQueueAction(updatedSaveQueue));
    return { success: true, updatedSaveQueue };
  }
  return { success: false, updatedSaveQueue: undefined };
}

function getUpToDateSegmentIdViaPosition(
  actionTracingId: string,
  originalSegmentId: number,
  anchorPosition: Vector3 | undefined | null,
  additionalCoordinates: AdditionalCoordinate[] | undefined | null,
  activeMappingByLayer: Record<string, ActiveMappingInfo>,
  anchorPositionToUnmappedIdByMappingId: AnchorPositionToUnmappedIdByMappingId,
) {
  /*
   * Update actions for segments always refer to a specific segment id. However,
   * it might happen that that ID doesn't match the user's intention anymore, because
   * agglomerates could have been split or merged in the meantime.
   * Example:
   * - User 1 updates segment 1
   * - In the meantime, user 2 merged segment 1 into 2 so that only segment 2 exists afterwards.
   * This function would map id 1 to 2 in that case so that the update of user 1 doesn't get lost.
   *
   * Mapping from old to new id is done by using the anchor position of the segment item and
   * looking up the unmapped and mapped id in the provided dictionaries.
   *
   * Note:
   * The id adaption can only work if the anchor position exists. In rare cases, no anchor position
   * will be known (e.g., when using a script to change the color of segments, no anchor position will
   * be provided usually).
   * Another (more realistic) case where the mapping won't work is when a user removed a segment
   * (then, the local store won't have the item and therefore no anchor position).
   * In that case, the id won't be adapted and the segment look up in the forwarded state
   * won't find anything if the segment was merged/split by another user.
   * Therefore, the update action will be dropped.
   * The impact of this is low, though, because one could also argue that the removal should be
   * ignored *because* another user merged/split that segment anyway.
   */
  const mappingSyncedWithBackendUnwrapped = activeMappingByLayer[actionTracingId]?.mapping;

  if (anchorPosition == null || mappingSyncedWithBackendUnwrapped == null) {
    return originalSegmentId;
  }

  const unmappedId = anchorPositionToUnmappedIdByMappingId
    .get(actionTracingId)
    ?.get(segmentPositionToKey(anchorPosition, additionalCoordinates));
  if (unmappedId == null) {
    return originalSegmentId;
  }

  const mappingSyncedWithBackend = new NumberLikeMapWrapper(mappingSyncedWithBackendUnwrapped);
  return (
    mappingSyncedWithBackend.getAsNumber(unmappedId) ??
    // This fallback should not happen because addMissingSegmentsToLoadedMappings
    // is called earlier.
    originalSegmentId
  );
}

// This function updates the agglomerate ids of source- and targetInformation from proofreading actions,
// put into the store by them (state.save.proofreadingPostProcessingInfo).
// Ensure that the post processing of a proofreading interaction by a saga in proofread_saga.tsx has
// agglomerate id information from the state where the latest backend updates were applied but the own
// mapping changes are not yet applied.
export function* updatePendingProofreadingOperationInfo(): Saga<void> {
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
