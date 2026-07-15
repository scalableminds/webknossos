import Toast from "libs/toast";
import messages from "messages";
import { call, put } from "typed-redux-saga";
import { isConcurrentCollaborationMode } from "viewer/model/accessors/annotation_accessor";
import {
  dispatchEnsureHasNewestVersionAsync,
  setPendingProofreadingOperationInfoAction,
} from "viewer/model/actions/save_actions";
import type { Saga } from "viewer/model/sagas/effect_generators";
import { select } from "viewer/model/sagas/effect_generators";
import { Model, Store } from "viewer/singletons";
import type { ProofreadingActionMappingInfo } from "viewer/store";
import type { OperationContext } from "../../operation_context_saga";
import { subscribeToAnnotationMutex } from "../../saving/save_mutex_saga";
import type { IdInfo, IdInfoOpt, IdInfoWithoutPosition } from "./proofreading_types";

export function* syncWithBackend(ctx: OperationContext | undefined): Saga<void> {
  yield* call([Model, Model.ensureSavedState], ctx);
}

export function* pollNewestBackendVersion(ctx: OperationContext): Saga<void> {
  yield* call(dispatchEnsureHasNewestVersionAsync, Store.dispatch, ctx);
}

export function* subscribeToAnnotationMutexInLiveCollab(proofreadingSagaId: string) {
  const isConcurrentCollab = yield* select(isConcurrentCollaborationMode);
  if (isConcurrentCollab) {
    return yield* call(subscribeToAnnotationMutex, proofreadingSagaId);
  }
  return null;
}

export function* pushPendingProofreadingOperationInfo(
  volumeTracingId: string,
  sourceInfo: ProofreadingActionMappingInfo,
  targetInfo: ProofreadingActionMappingInfo | null = null,
): Saga<void> {
  // For proper post processing, it is necessary that sourceInfo & targetInfo (does make sense in splitting operations)
  // have the correct agglomerate id values at the state on which this proofreading action
  // is applied to. Due to first applying new update actions from the backend, the agglomerate id
  // info might not be correct which is currently, stored in sourceInfo & targetInfo.
  // Thus, in case the the saving first applies new missing update actions from the backend, we temporarily put
  // the source- & targetInfo into the store, so that the save saga can update them after applying new backend actions
  // and before the mapping changes of this proofreading action are applied.
  // After saving the info should retrieved via the pop-variation of this function below.
  yield* put(
    setPendingProofreadingOperationInfoAction({
      tracingId: volumeTracingId,
      sourceInfo,
      targetInfo,
    }),
  );
}

function* popPendingProofreadingOperationInfo(): Saga<
  [ProofreadingActionMappingInfo, ProofreadingActionMappingInfo | null] | null
> {
  // See comment above.
  // After the proofreading update actions were stored on the server, the updated source & targetInfo
  // needs to retrieved and the PendingProofreadingOperationInfo should be cleared.
  const pendingProofreadingOperationInfo = yield* select(
    (state) => state.save.proofreadingPostProcessingInfo,
  );
  yield* put(setPendingProofreadingOperationInfoAction(null));
  if (pendingProofreadingOperationInfo != null) {
    return [
      pendingProofreadingOperationInfo.sourceInfo,
      pendingProofreadingOperationInfo.targetInfo,
    ];
  }
  return null;
}

export function* syncAndUpdatePostProcessingInfo<
  T1 extends IdInfo | IdInfoOpt | IdInfoWithoutPosition,
  T2 extends IdInfo | IdInfoOpt | IdInfoWithoutPosition,
>(
  sourceInfo: T1,
  targetInfo: T2,
  ctx: OperationContext,
): Saga<{ sourceInfo: T1; targetInfo: T2 } | null> {
  yield* call(syncWithBackend, ctx);
  const proofreadingPostProcessingInfo = yield* call(popPendingProofreadingOperationInfo);
  if (!proofreadingPostProcessingInfo) {
    Toast.error(messages["proofreading.post_processing_info_not_found"]);
    return null;
  }
  const updatedSourceInfo = {
    ...sourceInfo,
    agglomerateId: proofreadingPostProcessingInfo[0].agglomerateId,
  };
  const updatedTargetInfo = proofreadingPostProcessingInfo[1]
    ? { ...targetInfo, agglomerateId: proofreadingPostProcessingInfo[1].agglomerateId }
    : targetInfo;
  return { sourceInfo: updatedSourceInfo, targetInfo: updatedTargetInfo };
}
