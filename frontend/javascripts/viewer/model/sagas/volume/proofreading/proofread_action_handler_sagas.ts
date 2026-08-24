import { V3 } from "libs/mjs";
import Toast from "libs/toast";
import { isEditableEventTarget } from "libs/utils";
import messages from "messages";
import { all, call, put } from "typed-redux-saga";
import {
  isAnnotationEditableByNonOwners,
  mayEditAnnotation,
} from "viewer/model/accessors/annotation_accessor";
import { AnnotationTool } from "viewer/model/accessors/tool_accessor";
import {
  type MinCutAgglomerateWithPositionAction,
  type MinCutPartitionsAction,
  type ProofreadMergeAction,
  resetMultiCutToolPartitionsAction,
} from "viewer/model/actions/proofread_actions";
import { pushSaveQueueTransaction } from "viewer/model/actions/save_actions";
import { setMappingDataAction } from "viewer/model/actions/settings_actions";
import type { EnterAction } from "viewer/model/actions/ui_actions";
import { mergeSegmentItemsAction } from "viewer/model/actions/volumetracing_actions";
import type { Saga } from "viewer/model/sagas/effect_generators";
import { select } from "viewer/model/sagas/effect_generators";
import {
  mergeAgglomerate,
  type UpdateActionWithoutIsolationRequirement,
} from "viewer/model/sagas/volume/update_actions";
import { Store } from "viewer/singletons";
import type { Action } from "../../../actions/actions";
import type { OperationContext } from "../../operation_context_saga";
import { spawnUntilCanceled } from "../../saga_helpers";
import { syncAgglomerateTreesAfterMergeAction } from "./agglomerate_tree_syncing_saga_helpers";
import {
  pushPendingProofreadingOperationInfo,
  subscribeToAnnotationMutexInLiveCollab,
  syncAndUpdatePostProcessingInfo,
  syncWithBackend,
} from "./backend_sync_helper_sagas";
import { performCutFromNeighbors, performMinCut } from "./cut_operation_helper_sagas";
import { splitAgglomerateInMapping, updateMappingWithMerge } from "./local_mapping_update_sagas";
import {
  gatherInfoForOperation,
  getAgglomerateInfos,
  getPositionForSegmentId,
  lookupAgglomerateId,
  MISSING_INFORMATION_WARNING,
  prepareSplitOrMerge,
  reloadMappingAndAggloIds,
} from "./preparation_sagas";
import {
  maybeRefreshAffectedMeshes,
  refreshAffectedSegmentItems,
  refreshProofreadingSegmentsAndMeshes,
} from "./segment_and_mesh_refresh_sagas";

export function* performPartitionedMinCut(
  action: MinCutPartitionsAction | EnterAction,
  ctx: OperationContext,
): Saga<void> {
  const isMultiSplitActive = yield* select((state) => state.userConfiguration.isMultiSplitActive);
  const isFromEditingEvent = action.type === "ENTER" && isEditableEventTarget(action.event.target);
  const activeTool = yield* select((state) => state.uiInformation.activeTool);
  if (!isMultiSplitActive || activeTool !== AnnotationTool.PROOFREAD || isFromEditingEvent) {
    return;
  }

  const preparation = yield* call(prepareSplitOrMerge, false, ctx);
  if (!preparation) {
    return;
  }
  const partitions = yield* select(
    (state) =>
      state.localSegmentationStateByLayer[preparation.volumeTracing.tracingId].minCutPartitions,
  );
  let agglomerateId = partitions.agglomerateId;
  if (partitions[1].length <= 0 || partitions[2].length <= 0) {
    console.error(messages["proofreading.multi_cut.empty_partition"]);
    Toast.error(messages["proofreading.multi_cut.empty_partition"]);
    return;
  }
  if (agglomerateId == null) {
    console.error(messages["proofreading.multi_cut.no_valid_agglomerate"]);
    Toast.error(messages["proofreading.multi_cut.no_valid_agglomerate"]);
    return;
  }
  const volumeTracingId = preparation.volumeTracing.tracingId;
  const { agglomerateFileMag, annotationVersion } = preparation;

  const items: UpdateActionWithoutIsolationRequirement[] = [];

  const [hasErrored, edgesToRemove] = yield* call(
    performMinCut,
    agglomerateId,
    agglomerateId,
    partitions[1],
    partitions[2],
    agglomerateFileMag,
    volumeTracingId,
    null,
    annotationVersion,
    items,
  );
  if (hasErrored || edgesToRemove.length === 0) {
    console.error(messages["proofreading.multi_cut.split_failed"]);
    Toast.error(messages["proofreading.multi_cut.split_failed"]);
    return;
  }

  // Only one info object is needed as the min cut is performed on only one
  const dummySourceInfo = { agglomerateId, unmappedId: partitions[1][0] };

  yield* call(pushPendingProofreadingOperationInfo, volumeTracingId, dummySourceInfo);

  yield* put(pushSaveQueueTransaction(items));

  const unsubscribeFromAnnotationMutex = yield* call(
    subscribeToAnnotationMutexInLiveCollab,
    "Proofreading Partitioned Min-Cut",
  );
  try {
    const postProcessResult = yield* call(
      syncAndUpdatePostProcessingInfo,
      dummySourceInfo,
      dummySourceInfo,
      ctx,
    );
    if (!postProcessResult) return;
    const agglomerateIdBeforeSplit = postProcessResult.sourceInfo.agglomerateId;

    yield* put(resetMultiCutToolPartitionsAction());

    const activeMapping = yield* select(
      (store) => store.temporaryConfiguration.activeMappingByLayer[volumeTracingId],
    );

    // The agglomerateId of the split agglomerate might have changed due to syncing with the server caused by Model.ensureSavedState.
    // Thus we reload the agglomerateId via simply looking it up via the first segment of partition 1.
    agglomerateId = lookupAgglomerateId(activeMapping, partitions[1][0], agglomerateId);

    const unmappedSegmentsOfPartitions = new Set([...partitions[1], ...partitions[2]]);
    // Make sure the reloaded partial mapping has mapping info about the partitions and first removed edge. The first removed edge is used for reloading the meshes.
    // The unmapped segments of this edge might not be present in the partial mapping of the frontend as splitting can be done via mesh interactions.
    // There is no guarantee that for all mesh parts the mapping is locally stored.
    // So we put them all into segmentsInvolvedInSplit.
    // All these segments belonged to agglomerateId before the (min-cut) split.
    const segmentsInvolvedInSplit = unmappedSegmentsOfPartitions.union(
      new Set([edgesToRemove[0].segmentId1, edgesToRemove[0].segmentId2]),
    );

    // Now that the changes are saved, we can split the mapping locally (because it requires
    // communication with the backend).
    const currentVersion = Store.getState().annotation.version;

    const autoUpdateAgglomerateTrees = true;
    const splitMappingInfo = yield* splitAgglomerateInMapping(
      activeMapping,
      agglomerateId,
      segmentsInvolvedInSplit,
      volumeTracingId,
      currentVersion,
      autoUpdateAgglomerateTrees,
      // Min-cut reads the partition/edge segments back from the mapping, so they must be added.
      true,
    );
    if (splitMappingInfo == null) {
      console.error("Failed to split mapping in partitioned min cut. Aborting...");
      return;
    }
    const { mappingWithSplitApplied } = splitMappingInfo;

    yield* put(
      setMappingDataAction(
        volumeTracingId,
        mappingWithSplitApplied,
        // As these split actions were already sent to the server, mappingWithSplitApplied is stored on the server already.
        true,
      ),
    );

    /* Reload meshes */
    const newAgglomerateIdFromPartition1 = yield* call(
      preparation.mapSegmentId,
      partitions[1][0],
      mappingWithSplitApplied,
    );
    const newAgglomerateIdFromPartition2 = yield* call(
      preparation.mapSegmentId,
      partitions[2][0],
      mappingWithSplitApplied,
    );

    // Get positions of new meshes from first split edge information.
    const firstEdgeFirstSegmentNewAgglomerate = yield* call(
      preparation.mapSegmentId,
      edgesToRemove[0].segmentId1,
      mappingWithSplitApplied,
    );
    const meshLoadingPositionForPartition1 =
      firstEdgeFirstSegmentNewAgglomerate === newAgglomerateIdFromPartition1
        ? edgesToRemove[0].position1
        : edgesToRemove[0].position2;
    const meshLoadingPositionForPartition2 =
      firstEdgeFirstSegmentNewAgglomerate === newAgglomerateIdFromPartition2
        ? edgesToRemove[0].position1
        : edgesToRemove[0].position2;

    /* Ensure segment items exist for affected segments and reload affected meshes */
    const refreshInfos = [
      {
        oldAgglomerateId: agglomerateIdBeforeSplit,
        newAgglomerateId: newAgglomerateIdFromPartition1,
        nodePosition: meshLoadingPositionForPartition1,
      },
      {
        oldAgglomerateId: agglomerateIdBeforeSplit,
        newAgglomerateId: newAgglomerateIdFromPartition2,
        nodePosition: meshLoadingPositionForPartition2,
      },
    ];
    yield* call(refreshAffectedSegmentItems, volumeTracingId, refreshInfos);

    // Now that the segment items are up-to-date we can sync with the back-end
    // and release the mutex.
    yield* call(syncWithBackend, ctx);

    // Refreshing the meshes might take a while and won't block the saga
    // here.
    yield* spawnUntilCanceled(maybeRefreshAffectedMeshes, volumeTracingId, refreshInfos);
  } finally {
    if (unsubscribeFromAnnotationMutex) {
      yield* call(unsubscribeFromAnnotationMutex);
    }
  }
}

export function* handleProofreadMerge(action: ProofreadMergeAction, ctx: OperationContext) {
  const allowUpdate = yield* select((state) => mayEditAnnotation(state));
  if (!allowUpdate) return;

  const preparation = yield* call(prepareSplitOrMerge, false, ctx);
  if (!preparation) return;

  let { volumeTracing, activeMapping } = preparation;
  const { tracingId: volumeTracingId } = volumeTracing;
  const idInfos = yield* call(gatherInfoForOperation, action, preparation);

  if (idInfos == null) {
    console.warn("[Proofreading] Could not gather id infos.");
    return;
  }
  let [sourceInfo, targetInfo] = idInfos.infos;
  let sourceAgglomerateId = sourceInfo.agglomerateId;
  let targetAgglomerateId = targetInfo.agglomerateId;

  if (sourceAgglomerateId === targetAgglomerateId) {
    Toast.error(
      `Segments that should be merged need to be in different agglomerates. Both segments belong to agglomerate id=${sourceAgglomerateId}`,
    );
    return;
  }

  /* Send the merge update action to the backend (by pushing to the save queue and saving immediately) */
  const updateActions: UpdateActionWithoutIsolationRequirement[] = [
    mergeAgglomerate(
      sourceInfo.unmappedId,
      targetInfo.unmappedId,
      sourceAgglomerateId,
      targetAgglomerateId,
      volumeTracingId,
    ),
  ];

  console.log(
    "Merging agglomerate",
    sourceAgglomerateId,
    "with",
    targetAgglomerateId,
    "and segment ids",
    sourceInfo.unmappedId,
    targetInfo.unmappedId,
  );
  yield* call(
    updateMappingWithMerge,
    volumeTracingId,
    activeMapping,
    sourceAgglomerateId,
    targetAgglomerateId,
    false,
  );

  yield* call(pushPendingProofreadingOperationInfo, volumeTracingId, sourceInfo, targetInfo);
  yield* put(pushSaveQueueTransaction(updateActions));
  const unsubscribeFromAnnotationMutex = yield* call(
    subscribeToAnnotationMutexInLiveCollab,
    "Proofreading Merge",
  );
  try {
    // Remove the segment that doesn't exist anymore.
    yield* put(
      mergeSegmentItemsAction(
        sourceAgglomerateId,
        targetAgglomerateId,
        sourceInfo.unmappedId,
        targetInfo.unmappedId,
        volumeTracingId,
      ),
    );

    const postProcessResult = yield* call(() =>
      syncAndUpdatePostProcessingInfo(sourceInfo, targetInfo, ctx),
    );
    if (!postProcessResult) return;
    ({ sourceInfo, targetInfo } = postProcessResult);

    // After saving and thus syncing with the server the mapping might have updated due to missing proofreading actions for other users.
    // Thus, the sourceAgglomerateId and targetAgglomerateId might be outdated. Therefore, we reload them.
    const newInfo = yield* call(
      reloadMappingAndAggloIds,
      volumeTracing.tracingId,
      sourceInfo.unmappedId,
      targetInfo.unmappedId,
    );
    if (!newInfo) {
      Toast.error(
        `Could not reload the agglomerate information for proofreading operation segments.`,
      );
      return;
    }
    activeMapping = newInfo.activeMapping;
    sourceAgglomerateId = newInfo.sourceAgglomerateId;
    targetAgglomerateId = newInfo.targetAgglomerateId;

    // Reload the agglomerate trees affected by the merge if they are loaded.
    yield* call(
      syncAgglomerateTreesAfterMergeAction,
      sourceInfo.agglomerateId,
      targetInfo.agglomerateId,
      sourceAgglomerateId,
      volumeTracingId,
    );

    yield* call(
      refreshProofreadingSegmentsAndMeshes,
      volumeTracingId,
      sourceInfo,
      targetInfo,
      sourceAgglomerateId,
      targetAgglomerateId,
      ctx,
    );
  } finally {
    if (unsubscribeFromAnnotationMutex) {
      yield* call(unsubscribeFromAnnotationMutex);
    }
  }
}

export function* handleMinCutAgglomerate(
  action: MinCutAgglomerateWithPositionAction,
  ctx: OperationContext,
) {
  const allowUpdate = yield* select((state) => mayEditAnnotation(state));
  if (!allowUpdate) return;

  const preparation = yield* call(prepareSplitOrMerge, false, ctx);
  if (!preparation) return;

  let { agglomerateFileMag, volumeTracing, activeMapping, annotationVersion } = preparation;
  const { tracingId: volumeTracingId } = volumeTracing;
  const idInfos = yield* call(gatherInfoForOperation, action, preparation);

  if (idInfos == null) {
    console.warn("[Proofreading] Could not gather id infos.");
    return;
  }
  let [sourceInfo, targetInfo] = idInfos.infos;
  let sourceAgglomerateId = sourceInfo.agglomerateId;
  let targetAgglomerateId = targetInfo.agglomerateId;

  if (sourceInfo.unmappedId === targetInfo.unmappedId) {
    Toast.error(
      "The selected positions are both part of the same base segment and cannot be split. Please select another position or use the nodes of the agglomerate tree to perform the split.",
    );
    return;
  }

  /* Send the split update action to the backend (by pushing to the save queue and saving immediately) */
  const updateActions: UpdateActionWithoutIsolationRequirement[] = [];
  const [hasErrored] = yield* call(
    performMinCut,
    sourceAgglomerateId,
    targetAgglomerateId,
    [sourceInfo.unmappedId],
    [targetInfo.unmappedId],
    agglomerateFileMag,
    volumeTracingId,
    null,
    annotationVersion,
    updateActions,
  );
  if (hasErrored) {
    console.error(messages["proofreading.multi_cut.split_failed"]);
    Toast.error(messages["proofreading.multi_cut.split_failed"]);
    return;
  }

  if (updateActions.length === 0) {
    return;
  }
  yield* call(pushPendingProofreadingOperationInfo, volumeTracingId, sourceInfo, targetInfo);
  yield* put(pushSaveQueueTransaction(updateActions));
  const unsubscribeFromAnnotationMutex = yield* call(
    subscribeToAnnotationMutexInLiveCollab,
    "Proofreading Min-Cut",
  );
  try {
    const postProcessResult = yield* call(() =>
      syncAndUpdatePostProcessingInfo(sourceInfo, targetInfo, ctx),
    );
    if (!postProcessResult) return;
    ({ sourceInfo, targetInfo } = postProcessResult);

    if (sourceAgglomerateId !== targetAgglomerateId) {
      const othersMayEdit = yield* select((state) =>
        isAnnotationEditableByNonOwners(state.annotation),
      );
      const additionalErrorExplanation = othersMayEdit
        ? " Maybe another user already split the agglomerate in the meantime."
        : "";
      Toast.error(
        `The selected positions are not part of the same agglomerate and cannot be split.${additionalErrorExplanation}`,
      );
      return;
    }

    // After saving and thus syncing with the server the mapping might have updated due to missing proofreading actions for other users.
    // Thus, the sourceAgglomerateId and targetAgglomerateId might be outdated. Therefore, we reload them.
    annotationVersion = yield* select((state) => state.annotation.version);

    // Get latest agglomerate id of the agglomerate that was split by the current operation in case it changed due to rebasing or so.
    const latestInfo = yield* call(
      reloadMappingAndAggloIds,
      volumeTracing.tracingId,
      sourceInfo.unmappedId,
      targetInfo.unmappedId,
    );
    if (!latestInfo) {
      Toast.error(
        `Could not reload the agglomerate information for proofreading split segments operation.`,
      );
      return;
    }
    activeMapping = latestInfo.activeMapping;
    const latestSourceAgglomerateId = latestInfo.sourceAgglomerateId;

    console.log("start updating the mapping after a min-cut");
    // Now that the changes are saved, we can split the local mapping (because it requires
    // communication with the back-end).
    const autoUpdateAgglomerateTrees = true;
    const splitMappingInfo = yield* splitAgglomerateInMapping(
      activeMapping,
      latestSourceAgglomerateId,
      [sourceInfo.unmappedId],
      volumeTracingId,
      annotationVersion,
      autoUpdateAgglomerateTrees,
    );

    if (splitMappingInfo == null) {
      console.error("Failed to split mapping in proofreading action. Aborting...");
      return;
    }
    const { mappingWithSplitApplied } = splitMappingInfo;

    yield* put(
      setMappingDataAction(
        volumeTracingId,
        mappingWithSplitApplied,
        // As these split actions were already sent to the server, mappingWithSplitApplied is stored on the server already.
        true,
      ),
    );

    // Now that the local mapping information has changed due to the reloading of the mapping,
    // reload the agglomerate id info and the mapping.
    const newInfo = yield* call(
      reloadMappingAndAggloIds,
      volumeTracing.tracingId,
      sourceInfo.unmappedId,
      targetInfo.unmappedId,
    );
    if (!newInfo) {
      Toast.error(
        `Could not reload the agglomerate information for proofreading operation segments.`,
      );
      return;
    }
    activeMapping = newInfo.activeMapping;
    sourceAgglomerateId = newInfo.sourceAgglomerateId;
    targetAgglomerateId = newInfo.targetAgglomerateId;

    yield* call(
      refreshProofreadingSegmentsAndMeshes,
      volumeTracingId,
      sourceInfo,
      targetInfo,
      sourceAgglomerateId,
      targetAgglomerateId,
      ctx,
    );
  } finally {
    if (unsubscribeFromAnnotationMutex) {
      yield* call(unsubscribeFromAnnotationMutex);
    }
  }
}

export function* handleProofreadCutFromNeighbors(action: Action, ctx: OperationContext) {
  // Actually, action is CutAgglomerateFromNeighborsAction but the
  // takeEveryUnlessBusy wrapper does not understand this.
  if (action.type !== "CUT_AGGLOMERATE_FROM_NEIGHBORS") {
    return;
  }

  // This action does not depend on the active agglomerate. Instead, it
  // only depends on the rightclicked agglomerate.

  const allowUpdate = yield* select(mayEditAnnotation);
  if (!allowUpdate) return;

  const preparation = yield* call(prepareSplitOrMerge, false, ctx);
  if (!preparation) {
    return;
  }
  const { agglomerateFileMag, getDataValue, volumeTracing, annotationVersion } = preparation;
  const { tracingId: volumeTracingId } = volumeTracing;

  let idInfos;
  let targetPosition = null;
  if (action.position != null) {
    targetPosition = V3.floor(action.position);
    idInfos = yield* call(getAgglomerateInfos, preparation.getMappedAndUnmapped, [targetPosition]);
  } else {
    if (action.agglomerateId == null || action.segmentId == null) {
      Toast.warning(MISSING_INFORMATION_WARNING);
      console.log("Some fields were null:", {
        agglomerateId: action.agglomerateId,
        segmentId: action.segmentId,
      });
      return;
    }
    idInfos = [{ agglomerateId: action.agglomerateId, unmappedId: action.segmentId }];

    targetPosition = yield* call(getPositionForSegmentId, volumeTracing, action.segmentId);
  }
  if (!idInfos) {
    return;
  }
  let targetAgglomerateId = idInfos[0].agglomerateId;
  const targetSegmentId = idInfos[0].unmappedId;

  /* Send the respective split/merge update action to the backend (by pushing to the save queue
     and saving immediately) */
  const updateActions: UpdateActionWithoutIsolationRequirement[] = [];

  const { didCancel, neighborInfo } = yield* call(
    performCutFromNeighbors,
    targetAgglomerateId,
    targetSegmentId,
    targetPosition,
    agglomerateFileMag,
    volumeTracingId,
    annotationVersion,
    action.tree,
    updateActions,
  );
  if (didCancel || updateActions.length === 0) {
    return;
  }

  // Push same info twice as the interface currently, required source & target but cut from all neighbors only has one.
  yield* call(pushPendingProofreadingOperationInfo, volumeTracingId, idInfos[0], idInfos[0]);

  yield* put(pushSaveQueueTransaction(updateActions));
  const unsubscribeFromAnnotationMutex = yield* call(
    subscribeToAnnotationMutexInLiveCollab,
    "Proofreading Split From All Neighbors",
  );
  try {
    const dummyInfo = idInfos[0];
    const postProcessResult = yield* call(
      syncAndUpdatePostProcessingInfo,
      dummyInfo,
      dummyInfo,
      ctx,
    );
    if (!postProcessResult) return;
    const targetAgglomerateIdBeforeSplit = postProcessResult.sourceInfo.agglomerateId;

    // Get active mapping after saving and thus syncing with the backend as this might have changed the mapping.
    const activeMapping = yield* select(
      (store) => store.temporaryConfiguration.activeMappingByLayer[volumeTracing.tracingId],
    );

    // The agglomerateId might have changed due to syncing with the server. Reload it from the mapping.
    targetAgglomerateId = lookupAgglomerateId(activeMapping, targetSegmentId, targetAgglomerateId);

    const newAnnotationVersion = yield* select((state) => state.annotation.version);
    // Now that the changes are saved, we can split the mapping locally (because it requires
    // communication with the back-end).
    const autoUpdateAgglomerateTrees = true;
    const splitMappingInfo = yield* splitAgglomerateInMapping(
      activeMapping,
      targetAgglomerateId,
      [targetSegmentId],
      volumeTracingId,
      newAnnotationVersion,
      autoUpdateAgglomerateTrees,
    );

    if (splitMappingInfo == null) {
      console.error("Failed to split mapping in cut from all neighbors. Aborting...");
      return;
    }
    const { mappingWithSplitApplied } = splitMappingInfo;

    yield* put(
      setMappingDataAction(
        volumeTracingId,
        mappingWithSplitApplied,
        // As these split actions were already sent to the server, mappingWithSplitApplied is stored on the server already.
        true,
      ),
    );

    const [newTargetAgglomerateId, ...newNeighborAgglomerateIds] = yield* all([
      call(getDataValue, targetPosition, mappingWithSplitApplied),
      ...neighborInfo.neighbors.map((neighbor) =>
        call(getDataValue, neighbor.position, mappingWithSplitApplied),
      ),
    ]);

    /* Ensure segment items exist for affected segments and reload affected meshes */
    const refreshInfos = [
      {
        oldAgglomerateId: targetAgglomerateIdBeforeSplit,
        newAgglomerateId: newTargetAgglomerateId,
        nodePosition: targetPosition,
      },
      ...neighborInfo.neighbors.map((neighbor, idx) => ({
        oldAgglomerateId: targetAgglomerateIdBeforeSplit,
        newAgglomerateId: newNeighborAgglomerateIds[idx],
        nodePosition: neighbor.position,
      })),
    ];
    yield* call(refreshAffectedSegmentItems, volumeTracingId, refreshInfos);

    yield* call(syncWithBackend, ctx);

    // Refreshing the meshes might take a while and won't block the saga
    // here.
    yield* spawnUntilCanceled(maybeRefreshAffectedMeshes, volumeTracingId, refreshInfos);
  } finally {
    if (unsubscribeFromAnnotationMutex) {
      yield* call(unsubscribeFromAnnotationMutex);
    }
  }
}
