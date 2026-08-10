import { getAgglomeratesForSegmentsFromTracingstore } from "admin/rest_api";
import { NumberLikeMapWrapper } from "libs/number_like_map_wrapper";
import { call, put } from "typed-redux-saga";
import { setPendingProofreadingOperationInfoAction } from "viewer/model/actions/save_actions";
import type { Saga } from "viewer/model/sagas/effect_generators";
import { select } from "viewer/model/sagas/effect_generators";
import type { SaveQueueEntry } from "viewer/store";
import type { ServerUpdateAction } from "../../volume/update_actions";

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

// This function updates the agglomerate ids of source- and targetInformation from proofreading actions
// (state.save.proofreadingPostProcessingInfo), to ensure that the post processing of a proofreading
// interaction by a saga in proofread_saga.tsx has agglomerate id information from the state where the
// latest backend updates were applied but the own mapping changes are not yet applied. This is needed
// to have correct information about what agglomerate ids were actually affected by a proofreading action
// done by the local user. The info correctness is essential to properly reload and synchronize loaded
// agglomerate trees and meshes.
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
