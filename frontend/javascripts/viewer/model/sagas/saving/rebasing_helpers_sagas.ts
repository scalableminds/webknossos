import { getAgglomeratesForSegmentsFromTracingstore } from "admin/rest_api";
import { getAdaptToTypeFunction } from "libs/utils";
import omitBy from "lodash-es/omitBy";
import { call, put } from "typed-redux-saga";
import type { APIUpdateActionBatch } from "types/api_types";
import { replaceSaveQueueAction } from "viewer/model/actions/save_actions";
import { setMappingAction } from "viewer/model/actions/settings_actions";
import type { Saga } from "viewer/model/sagas/effect-generators";
import { select } from "viewer/model/sagas/effect-generators";
import type { Mapping, NumberLikeMap, SaveQueueEntry } from "viewer/store";
import type {
  MergeAgglomerateUpdateAction,
  ServerUpdateAction,
  SplitAgglomerateUpdateAction,
  UpdateSegmentPartialUpdateAction,
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

// Gathers mapped agglomerate ids for unknown but relevant segments to apply the passed save queue entries correctly.
// This is needed in case proofreading was done via mesh interactions whose mapping info is present in the meshes
// but not in the activeMappingByLayer.mapping. Due to incorporating backend updates the agglomerate ids of the
// meshes might be outdated, thus we reload this info and store it in the local mapping to perform the correct merge.
// Returns a list of segment ids to reload for each needed volume / editable tracing id.
function* getAllUnknownSegmentIdsInPendingUpdates(
  saveQueue: SaveQueueEntry[],
): Saga<IdsToReloadPerMappingId> {
  const activeMappingByLayer = yield* select(
    (store) => store.temporaryConfiguration.activeMappingByLayer,
  );
  const idsToReloadByMappingId = {} as IdsToReloadPerMappingId;
  for (const saveQueueEntry of saveQueue) {
    for (const action of saveQueueEntry.actions) {
      switch (action.name) {
        case "mergeAgglomerate":
        case "splitAgglomerate": {
          const { segmentId1, segmentId2, actionTracingId } = action.value;
          const mappingSyncedWithBackend = activeMappingByLayer[actionTracingId]?.mapping;
          if (!mappingSyncedWithBackend || segmentId1 == null || segmentId2 == null) {
            continue;
          }

          const adaptToType = getAdaptToTypeFunction(mappingSyncedWithBackend);
          const updatedAgglomerateId1 = (mappingSyncedWithBackend as NumberLikeMap).get(
            adaptToType(segmentId1),
          );
          const updatedAgglomerateId2 = (mappingSyncedWithBackend as NumberLikeMap).get(
            adaptToType(segmentId2),
          );
          if (!updatedAgglomerateId1) {
            if (!(actionTracingId in idsToReloadByMappingId)) {
              idsToReloadByMappingId[actionTracingId] = [];
            }
            idsToReloadByMappingId[actionTracingId].push(segmentId1);
          }
          if (!updatedAgglomerateId2) {
            if (!(actionTracingId in idsToReloadByMappingId)) {
              idsToReloadByMappingId[actionTracingId] = [];
            }
            idsToReloadByMappingId[actionTracingId].push(segmentId2);
          }
        }
      }
    }
  }
  return idsToReloadByMappingId;
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
  appliedBackendUpdateActions: APIUpdateActionBatch[],
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
  const idsToFetch = yield* call(getAllUnknownSegmentIdsInPendingUpdates, saveQueue);
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
            case "splitAgglomerate": {
              const { segmentId1, segmentId2, actionTracingId } = action.value;
              const mappingSyncedWithBackend = activeMappingByLayer[actionTracingId]?.mapping;
              if (!mappingSyncedWithBackend) {
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

              const adaptToType = getAdaptToTypeFunction(mappingSyncedWithBackend);
              let upToDateAgglomerateId1 = (mappingSyncedWithBackend as NumberLikeMap).get(
                adaptToType(segmentId1),
              );
              let upToDateAgglomerateId2 = (mappingSyncedWithBackend as NumberLikeMap).get(
                adaptToType(segmentId2),
              );
              if (!upToDateAgglomerateId1 || !upToDateAgglomerateId2) {
                console.error(
                  "Found proofreading action without loaded agglomerate ids. This should never occur.",
                  action,
                );
                success = false;
                return null;
              }
              if (action.name === "mergeAgglomerate") {
                return {
                  name: action.name,
                  value: {
                    ...action.value,
                    agglomerateId1: Number(upToDateAgglomerateId1),
                    agglomerateId2: Number(upToDateAgglomerateId2),
                  },
                } satisfies MergeAgglomerateUpdateAction;
              } else {
                return {
                  name: action.name,
                  value: {
                    ...action.value,
                    agglomerateId: Number(upToDateAgglomerateId1),
                  },
                } satisfies SplitAgglomerateUpdateAction;
              }
            }
            case "createSegment": {
              const { actionTracingId } = action.value;

              const tracing = annotationBeforeUpdate.volumes.find(
                (v) => v.tracingId === actionTracingId,
              );
              const maybeExistingSegment = tracing?.segments.getNullable(action.value.id);

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
                  id: action.value.id,
                },
              };
              return newAction;
            }
            case "updateSegmentPartial": {
              const { actionTracingId } = action.value;

              const tracing = annotationBeforeUpdate.volumes.find(
                (v) => v.tracingId === actionTracingId,
              );
              const maybeExistingSegment = tracing?.segments.getNullable(action.value.id);

              if (!maybeExistingSegment) {
                // Another user removed the segment. The update action of the current user gets lost now.
                return null;
              }

              // Since the update action precisely encodes what changed within the segment,
              // we don't need to adapt the action itself.
              return action;
            }
            case "deleteSegment": {
              const { actionTracingId } = action.value;
              const tracing = annotationBeforeUpdate.volumes.find(
                (v) => v.tracingId === actionTracingId,
              );
              const maybeExistingSegment = tracing?.segments.getNullable(action.value.id);

              if (!maybeExistingSegment) {
                // Another user removed the segment. The update action of the current user gets lost now.
                return null;
              }
              return action;
            }
            case "mergeSegments": {
              const mergeActions = appliedBackendUpdateActions
                .flatMap((batch) => batch.value)
                // These filters cannot be combined because TS cannot do type narrowing then.
                .filter((mergeAction) => mergeAction.name === "mergeSegments")
                .filter(
                  (mergeAction) =>
                    mergeAction.value.actionTracingId === action.value.actionTracingId,
                );

              // After partialMapping is constructed, it contains the information
              // how segment ids were changed by the most recent backend actions. A key-value pair
              // denotes that segment $key was mapped to $value (potentially, as a result of
              // multiple update actions)
              // Keys that don't exist in partialMapping denote an identity mapping (i.e., key === value).
              const partialMapping = new Map<number, number>();
              for (const mergeAction of mergeActions) {
                // sourceId "swallows" targetId (i.e., targetId will be overwritten
                // with sourceId)
                const { sourceId, targetId } = mergeAction.value;
                if (partialMapping.get(targetId) == null) {
                  // targetId wasn't mapped yet. Do that now.
                  partialMapping.set(targetId, sourceId);
                }
                // Iterate through all entries to see whether the value
                // needs to be adapted.
                for (const [key, value] of partialMapping.entries()) {
                  if (value === targetId) {
                    partialMapping.set(key, sourceId);
                  }
                }
              }

              const newSourceId =
                partialMapping.get(action.value.sourceId) ?? action.value.sourceId;
              const newTargetId =
                partialMapping.get(action.value.targetId) ?? action.value.targetId;

              return {
                ...action,
                value: {
                  ...action.value,
                  sourceId: newSourceId,
                  targetId: newTargetId,
                },
              };
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
