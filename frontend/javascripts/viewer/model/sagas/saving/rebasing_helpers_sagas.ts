import { getAgglomeratesForSegmentsFromTracingstore } from "admin/rest_api";
import { ColoredLogger, getAdaptToTypeFunction } from "libs/utils";
import { call, put } from "typed-redux-saga";
import { replaceSaveQueueAction } from "viewer/model/actions/save_actions";
import { setMappingAction } from "viewer/model/actions/settings_actions";
import type { Saga } from "viewer/model/sagas/effect-generators";
import { select } from "viewer/model/sagas/effect-generators";
import type { Mapping, NumberLikeMap, SaveQueueEntry, Segment } from "viewer/store";
import type {
  CreateSegmentUpdateAction,
  MergeAgglomerateUpdateAction,
  ServerUpdateAction,
  SplitAgglomerateUpdateAction,
  UpdateSegmentUpdateAction,
} from "../volume/update_actions";
import _ from "lodash";

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
export function* getAllUnknownSegmentIdsInPendingUpdates(
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
export function* addMissingSegmentsToLoadedMappings(
  idsToReload: IdsToReloadPerMappingId,
): Saga<void> {
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

// Gathers mapped info for segment ids from proofreading actions where the mapping is unknown.
// This happens in case of mesh proofreading actions. To re-apply the user's changes in the rebasing
// up-to-date mapping info is needed for all segments in all proofreading actions. Thus, the missing info
// is first loaded and then the save queue update actions are remapped to update their agglomerate id infos
// to apply them correctly during rebasing. Lastly, the save queue is replaced with the updated save queue entries.
export function* updateSaveQueueEntriesToStateAfterRebase(): Saga<
  | {
      success: false;
      updatedSaveQueue: undefined;
    }
  | {
      success: true;
      updatedSaveQueue: SaveQueueEntry[];
    }
> {
  // ColoredLogger.logRed("updateSaveQueueEntriesToStateAfterRebase");
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
              console.log("adapting createSegment action?", action);

              const { actionTracingId } = action.value;

              const tracing = annotationBeforeUpdate.volumes.find(
                (v) => v.tracingId === actionTracingId,
              );
              const maybeExistingSegment = tracing?.segments.getNullable(action.value.id);

              if (!maybeExistingSegment) {
                return action;
              }

              const newAction: UpdateSegmentUpdateAction = {
                name: "updateSegment",
                value: {
                  actionTracingId: action.value.actionTracingId,
                  id: action.value.id ?? maybeExistingSegment.id,
                  name: action.value.name ?? maybeExistingSegment.name,
                  anchorPosition:
                    action.value.anchorPosition ?? maybeExistingSegment.anchorPosition,
                  additionalCoordinates:
                    action.value.additionalCoordinates ??
                    maybeExistingSegment.additionalCoordinates,
                  creationTime: action.value.creationTime ?? maybeExistingSegment.creationTime,
                  color: action.value.color ?? maybeExistingSegment.color,
                  groupId: action.value.groupId ?? maybeExistingSegment.groupId,
                  metadata: action.value.metadata ?? maybeExistingSegment.metadata,
                  // ...action.value,
                },
                // todop: omit?
                changedPropertyNames: [],
              };
              return newAction;
            }
            case "updateSegment": {
              // ColoredLogger.logGreen("adapting updateSegment action?", action);

              const { actionTracingId } = action.value;

              const tracing = annotationBeforeUpdate.volumes.find(
                (v) => v.tracingId === actionTracingId,
              );
              const maybeExistingSegment = tracing?.segments.getNullable(action.value.id);

              if (!maybeExistingSegment) {
                // Another user removed the segment. The update action of the current user gets lost now.
                return null;
              }
              const changedPropertyNames = action.changedPropertyNames ?? [];

              const newAction: UpdateSegmentUpdateAction = {
                name: "updateSegment",
                value: {
                  actionTracingId: action.value.actionTracingId,
                  ...maybeExistingSegment,
                  ...Object.fromEntries(
                    changedPropertyNames.map((prop: keyof Segment) => [prop, action.value[prop]]),
                  ),
                },
                changedPropertyNames,
              };
              return newAction;
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
    // ColoredLogger.logRed("new updatedSaveQueue", updatedSaveQueue);
    yield put(replaceSaveQueueAction(updatedSaveQueue));
    return { success: true, updatedSaveQueue };
  }
  return { success: false, updatedSaveQueue: undefined };
}
