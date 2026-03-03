import { getAgglomeratesForSegmentsFromTracingstore } from "admin/rest_api";
import { NumberLikeMapWrapper } from "libs/number_like_map_wrapper";
import omitBy from "lodash-es/omitBy";
import { call, put } from "typed-redux-saga";
import type { AdditionalCoordinate, APIUpdateActionBatch } from "types/api_types";
import type { Vector3 } from "viewer/constants";
import { getAdditionalCoordinatesAsString } from "viewer/model/accessors/flycam_accessor";
import { replaceSaveQueueAction } from "viewer/model/actions/save_actions";
import { setMappingAction } from "viewer/model/actions/settings_actions";
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

type IdsToReloadPerMappingId = Record<string, number[]>;
type AnchorPositionToUnmappedIdByMappingId = Record<string, Record<string, number>>;

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
  const idsToReloadByMappingId = {} as IdsToReloadPerMappingId;
  const anchorPositionToUnmappedIdByMappingId: Record<string, Record<string, number>> = {};
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
  yield call([Promise, Promise.all], promises);
  return { idsToReloadByMappingId, anchorPositionToUnmappedIdByMappingId };
}

function appendToIdsToReloadMapping(
  actionTracingId: string,
  idsToReloadByMappingId: IdsToReloadPerMappingId,
  segmentId2: number,
) {
  if (!(actionTracingId in idsToReloadByMappingId)) {
    idsToReloadByMappingId[actionTracingId] = [];
  }
  idsToReloadByMappingId[actionTracingId].push(segmentId2);
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
  if (anchorPositionToUnmappedIdByMappingId[actionTracingId] == null) {
    anchorPositionToUnmappedIdByMappingId[actionTracingId] = {};
  }
  anchorPositionToUnmappedIdByMappingId[actionTracingId][anchorPositionKey] = unmappedId;
  appendToIdsToReloadMapping(actionTracingId, idsToReloadByMappingId, unmappedId);
}

function segmentPositionToKey(
  anchorPosition: Vector3,
  additionalCoordinates: AdditionalCoordinate[] | null | undefined,
) {
  return `${anchorPosition.join(",")}-${getAdditionalCoordinatesAsString(additionalCoordinates)}`;
}

// For each passed mapping, reload the segment ids' mapping information and store it in the local mapping.
// Needed after getAllUnknownSegmentIdsInPendingUpdates to load updated mapping info for segment ids of
// mesh interaction proofreading actions to ensure reapplying these actions is done with up-to-date mapping info.
function* addMissingSegmentsToLoadedMappings(idsToReload: IdsToReloadPerMappingId): Saga<void> {
  const annotationId = yield* select((state) => state.annotation.annotationId);
  const version = yield* select((state) => state.annotation.version);
  const tracingStoreUrl = yield* select((state) => state.annotation.tracingStore.url);
  const activeMappingByLayer = yield* select(
    (store) => store.temporaryConfiguration.activeMappingByLayer,
  );
  for (const volumeTracingId of Object.keys(idsToReload)) {
    if (idsToReload[volumeTracingId].length === 0) {
      continue;
    }
    const activeMapping = activeMappingByLayer[volumeTracingId];
    // Ask the server to map the segment ids needing reloading. This creates a partial mapping
    // that only contains these ids.
    const mappingWithMissingIds = yield* call(
      getAgglomeratesForSegmentsFromTracingstore,
      tracingStoreUrl,
      volumeTracingId,
      idsToReload[volumeTracingId],
      annotationId,
      version,
    );
    const mergedMapping = new Map(
      Array.from((activeMapping.mapping ?? new Map()) as NumberLikeMap).concat(
        Array.from(mappingWithMissingIds as NumberLikeMap),
      ),
    );
    yield* put(
      setMappingAction(
        volumeTracingId,
        activeMapping.mappingName,
        activeMapping.mappingType,
        // Although this version is stored on the server, the used version to fetch the mapping info might be different
        // from the version stored in RebaseRelevantAnnotationState. Thus, we update RebaseRelevantAnnotationState not via the
        // isVersionStoredOnServer below. Instead the higher level function of the rebasing process take care of updating the
        // RebaseRelevantAnnotationState.
        false,
        {
          mapping: mergedMapping as Mapping,
        },
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
  const annotationBeforeUpdate = yield* select((state) => state.annotation);

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
              const tracing = annotationBeforeUpdate.volumes.find(
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

              const tracingBeforeUpdate = annotationBeforeUpdate.volumes.find(
                (v) => v.tracingId === actionTracingId,
              );
              const maybeExistingSegment = tracingBeforeUpdate?.segments.getNullable(segmentId);

              if (!maybeExistingSegment) {
                // Another user removed the segment. The update action of the current user gets lost now.
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

  const unmappedId =
    anchorPositionToUnmappedIdByMappingId[actionTracingId][
      segmentPositionToKey(anchorPosition, additionalCoordinates)
    ];

  const mappingSyncedWithBackend = new NumberLikeMapWrapper(mappingSyncedWithBackendUnwrapped);
  return mappingSyncedWithBackend.getAsNumber(unmappedId);
}
