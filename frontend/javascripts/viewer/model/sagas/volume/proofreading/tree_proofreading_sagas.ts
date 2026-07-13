import Toast from "libs/toast";
import { all, call, put } from "typed-redux-saga";
import {
  isAgglomerateTree,
  isConcurrentCollaborationMode,
  mayEditAnnotation,
} from "viewer/model/accessors/annotation_accessor";
import {
  areGeometriesTransformed,
  enforceSkeletonTracing,
  findTreeByNodeId,
  getTreeNameForAgglomerateTree,
} from "viewer/model/accessors/skeletontracing_accessor";
import { AnnotationTool } from "viewer/model/accessors/tool_accessor";
import { getVolumeTracingById } from "viewer/model/accessors/volumetracing_accessor";
import type { MinCutAgglomerateAction } from "viewer/model/actions/proofread_actions";
import { pushSaveQueueTransaction } from "viewer/model/actions/save_actions";
import { setMappingDataAction } from "viewer/model/actions/settings_actions";
import {
  type DeleteEdgeAction,
  type MergeTreesAction,
  setTreeAgglomerateInfoIdAction,
  setTreeNameAction,
} from "viewer/model/actions/skeletontracing_actions";
import {
  mergeSegmentItemsAction,
  updateSegmentAction,
} from "viewer/model/actions/volumetracing_actions";
import type { Saga } from "viewer/model/sagas/effect_generators";
import { select } from "viewer/model/sagas/effect_generators";
import {
  mergeAgglomerate,
  splitAgglomerate,
  type UpdateActionWithoutIsolationRequirement,
} from "viewer/model/sagas/volume/update_actions";
import type { OperationContext } from "../../operation_context_saga";
import { spawnUntilCanceled } from "../../saga_helpers";
import {
  pollNewestBackendVersion,
  pushPendingProofreadingOperationInfo,
  subscribeToAnnotationMutexInLiveCollab,
  syncAndUpdatePostProcessingInfo,
  syncWithBackend,
} from "./backend_sync_helper_sagas";
import { performMinCut } from "./cut_operation_helper_sagas";
import { splitAgglomerateInMapping, updateMappingWithMerge } from "./local_mapping_update_sagas";
import { getAgglomerateInfos, lookupAgglomerateId, prepareSplitOrMerge } from "./preparation_sagas";
import {
  maybeRefreshAffectedMeshes,
  refreshAffectedSegmentItems,
} from "./segment_and_mesh_refresh_sagas";

// Shared setup for tree-based proofreading handlers. Returns null if the action should not proceed.
// Note: the skeletontracing reducer already mutated the trees according to the received action.
function* setupTreeProofreadingAction(
  action: MergeTreesAction | DeleteEdgeAction | MinCutAgglomerateAction,
  ctx: OperationContext,
) {
  const allowUpdate = yield* select(mayEditAnnotation);
  if (!allowUpdate) return null;

  // Reserve the mutex early to be able to synchronize the agglomerate trees with the newest backend state,
  // in case of live collab being active.
  // The reason is that in the meantime another user might have already manipulated the same agglomerate tree
  // as done by the current action. Thus, to avoid inconsistent states between the mapping and the agglomerate trees,
  // we first sync with the backend to have the newest agglomerate trees.
  // Additionally, the skeletontracing reducer ignores direct proofreading agglomerate tree updates, in case live collab is active.
  // We therefore explicitly replay the received actions after syncing with the backend, but setting this saga as the initiator.
  // This should ensure, that the agglomerate tree updates done by the user are always in sync with the backend state.
  const unsubscribeFromAnnotationMutex = yield* call(
    subscribeToAnnotationMutexInLiveCollab,
    "Proofreading via Trees",
  );

  let successfulReturn = false;
  try {
    const isLiveCollabActive = yield* select(isConcurrentCollaborationMode);
    if (isLiveCollabActive) {
      // If live collab is active and the user did a proofreading merge via edge creation / merge trees,
      // the affected agglomerate tree(s) may not be in sync with the backend yet. So poll the latest updates.
      // It is ensured that no new updates by other users are created during processing this proofreading
      // interaction as we subscribed to the mutex above.
      yield* call(pollNewestBackendVersion, ctx);
    }
    // Replay the current action with the proofreading saga as the initiator.
    // The reducer ignores the current action as the initiator is marked as "USER".
    const actionWithSagaAsInitiator = { ...action, initiator: "PROOFREADING" } as
      | DeleteEdgeAction
      | MergeTreesAction;
    yield* put(actionWithSagaAsInitiator);

    const { sourceNodeId, targetNodeId } = action;
    const skeletonTracing = yield* select((state) => enforceSkeletonTracing(state.annotation));
    const { trees } = skeletonTracing;
    const sourceTree = findTreeByNodeId(trees, sourceNodeId);
    const targetTree = findTreeByNodeId(trees, targetNodeId);

    if (sourceTree == null || targetTree == null) {
      return null;
    }

    const isModifyingOnlyAgglomerateTrees =
      isAgglomerateTree(sourceTree) && isAgglomerateTree(targetTree);
    const isModifyingAnyAgglomerateTrees =
      isAgglomerateTree(sourceTree) || isAgglomerateTree(targetTree);
    const isProofreadingToolActive = yield* select(
      (state) => state.uiInformation.activeTool === AnnotationTool.PROOFREAD,
    );

    if (isProofreadingToolActive && !isModifyingOnlyAgglomerateTrees) {
      Toast.warning(
        "Only agglomerate trees can be modified using the proofreading tool to edit the active mapping.",
        { timeout: 12000 },
      );
      return null;
    } else if (!isProofreadingToolActive && isModifyingAnyAgglomerateTrees) {
      Toast.warning(
        "In order to edit the active mapping by deleting or adding edges of agglomerate trees, the proofreading tool needs to be active." +
          " If you want to edit the active mapping, activate the proofreading tool and then redo the action.",
        { timeout: 12000 },
      );
      return null;
    }

    if (!isProofreadingToolActive) {
      return null;
    }

    const preparation = yield* call(prepareSplitOrMerge, true, ctx);
    if (!preparation) {
      return null;
    }

    // Use untransformedPosition because agglomerate trees should not have any transforms, anyway.
    if (yield* select((state) => areGeometriesTransformed(state))) {
      Toast.error(
        "Proofreading is currently not supported when the skeleton layer is transformed.",
      );
      return null;
    }

    const sourceNodePosition = sourceTree.nodes.getOrThrow(sourceNodeId).untransformedPosition;
    const targetNodePosition = targetTree.nodes.getOrThrow(targetNodeId).untransformedPosition;

    const idInfos = yield* call(getAgglomerateInfos, preparation.getMappedAndUnmapped, [
      sourceNodePosition,
      targetNodePosition,
    ]);
    if (!idInfos) {
      return null;
    }

    successfulReturn = true;
    return {
      unsubscribeFromAnnotationMutex,
      preparation,
      sourceTree,
      targetTree,
      sourceNodePosition,
      targetNodePosition,
      sourceNodeId,
      targetNodeId,
      idInfos,
    };
  } finally {
    if (!successfulReturn && unsubscribeFromAnnotationMutex) {
      yield* call(unsubscribeFromAnnotationMutex);
    }
  }
}

export function* handleMergeViaTree(action: MergeTreesAction, ctx: OperationContext): Saga<void> {
  // Ignore MergeTrees actions that were dispatched by the proofreading saga itself.
  if (action.initiator === "PROOFREADING") return;

  const setup = yield* call(setupTreeProofreadingAction, action, ctx);
  if (!setup) return;
  const {
    unsubscribeFromAnnotationMutex,
    preparation,
    sourceNodePosition,
    targetNodePosition,
    sourceNodeId,
    targetNodeId,
    idInfos,
  } = setup;

  try {
    const { getDataValue, volumeTracing } = preparation;
    let { activeMapping } = preparation;
    const { tracingId: volumeTracingId } = volumeTracing;

    let [sourceInfo, targetInfo] = idInfos;
    let sourceAgglomerateId = sourceInfo.agglomerateId;
    let targetAgglomerateId = targetInfo.agglomerateId;

    if (sourceAgglomerateId === targetAgglomerateId) {
      Toast.error("Segments that should be merged need to be in different agglomerates.");
      return;
    }

    /* Send the merge update action to the backend */
    const items: UpdateActionWithoutIsolationRequirement[] = [
      mergeAgglomerate(
        sourceInfo.unmappedId,
        targetInfo.unmappedId,
        sourceAgglomerateId,
        targetAgglomerateId,
        volumeTracingId,
      ),
    ];
    yield* call(
      updateMappingWithMerge,
      volumeTracingId,
      activeMapping,
      sourceAgglomerateId,
      targetAgglomerateId,
      false,
    );

    yield* call(pushPendingProofreadingOperationInfo, volumeTracingId, sourceInfo, targetInfo);
    yield* put(pushSaveQueueTransaction(items));
    const postProcessResult = yield* call(
      syncAndUpdatePostProcessingInfo,
      sourceInfo,
      targetInfo,
      ctx,
    );
    if (!postProcessResult) return;
    ({ sourceInfo, targetInfo } = postProcessResult);

    activeMapping = yield* select(
      (store) => store.temporaryConfiguration.activeMappingByLayer[volumeTracing.tracingId],
    );
    sourceAgglomerateId = lookupAgglomerateId(
      activeMapping,
      sourceInfo.unmappedId,
      sourceAgglomerateId,
    );

    const [newSourceAgglomerateId, newTargetAgglomerateId] = yield* all([
      call(getDataValue, sourceNodePosition, activeMapping.mapping),
      call(getDataValue, targetNodePosition, activeMapping.mapping),
    ]);

    let updatedSkeletonTracing = yield* select((state) => state.annotation.skeleton);
    if (!updatedSkeletonTracing) {
      Toast.error(
        "Could not reload skeleton tracing to update the tree names and refresh the auxiliary meshes after proofreading action via agglomerate trees.",
      );
      return;
    }

    // Reload sourceTree & targetTree as applying newest actions from the backend might have modified the skeleton.
    const updatedSourceTree = findTreeByNodeId(updatedSkeletonTracing.trees, sourceNodeId);
    const updatedTargetTree = findTreeByNodeId(updatedSkeletonTracing.trees, targetNodeId);

    if (updatedSourceTree == null || updatedTargetTree == null) {
      Toast.error("Couldn't find trees for nodes. Details are logged to the console.");
      console.error("Couldn't find trees for nodes. Details are logged to the console.", {
        sourceNodeId,
        updatedSourceTree,
        targetNodeId,
        updatedTargetTree,
      });
      return;
    }

    /* Rename agglomerate tree according to its new id and mapping name */
    yield* put(
      setTreeNameAction(
        getTreeNameForAgglomerateTree(newSourceAgglomerateId, volumeTracing.mappingName),
        updatedSourceTree.treeId,
      ),
    );
    yield* put(setTreeAgglomerateInfoIdAction(newSourceAgglomerateId, updatedSourceTree.treeId));

    // Also merge the segment items.
    yield* put(
      mergeSegmentItemsAction(
        sourceInfo.agglomerateId,
        targetInfo.agglomerateId,
        sourceInfo.unmappedId,
        targetInfo.unmappedId,
        volumeTracingId,
      ),
    );

    /* Ensure segment items exist for affected segments and reload affected meshes */
    const refreshInfos = [
      {
        oldAgglomerateId: sourceInfo.agglomerateId,
        newAgglomerateId: newSourceAgglomerateId,
        nodePosition: sourceNodePosition,
      },
      {
        oldAgglomerateId: targetInfo.agglomerateId,
        newAgglomerateId: newTargetAgglomerateId,
        nodePosition: targetNodePosition,
      },
    ];
    yield* call(refreshAffectedSegmentItems, volumeTracingId, refreshInfos);
    // Now that the segment items are up-to-date we can sync with the back-end and release the mutex.
    yield* call(syncWithBackend, ctx);

    // Refreshing the meshes might take a while and won't block the saga here.
    yield* spawnUntilCanceled(maybeRefreshAffectedMeshes, volumeTracingId, refreshInfos);
  } finally {
    if (unsubscribeFromAnnotationMutex) {
      yield* call(unsubscribeFromAnnotationMutex);
    }
  }
}

export function* handleSplitViaTree(
  action: DeleteEdgeAction | MinCutAgglomerateAction,
  ctx: OperationContext,
): Saga<void> {
  // Ignore DeleteEdge actions that were dispatched by the proofreading saga itself.
  if (action.type === "DELETE_EDGE" && action.initiator === "PROOFREADING") return;

  const setup = yield* call(setupTreeProofreadingAction, action, ctx);
  if (!setup) return;

  const {
    unsubscribeFromAnnotationMutex,
    preparation,
    sourceTree,
    sourceNodePosition,
    targetNodePosition,
    sourceNodeId,
    targetNodeId,
    idInfos,
  } = setup;
  try {
    const { agglomerateFileMag, getDataValue, volumeTracing, annotationVersion } = preparation;
    let { activeMapping } = preparation;
    const { tracingId: volumeTracingId } = volumeTracing;

    let [sourceInfo, targetInfo] = idInfos;
    let sourceAgglomerateId = sourceInfo.agglomerateId;
    let targetAgglomerateId = targetInfo.agglomerateId;

    /* Send the split update action to the backend */
    const items: UpdateActionWithoutIsolationRequirement[] = [];
    if (action.type === "DELETE_EDGE") {
      if (sourceAgglomerateId !== targetAgglomerateId) {
        Toast.error("Segments that should be split need to be in the same agglomerate.");
        return;
      }
      items.push(
        splitAgglomerate(
          sourceInfo.unmappedId,
          targetInfo.unmappedId,
          sourceAgglomerateId,
          volumeTracingId,
        ),
      );
    } else {
      const [hasErrored] = yield* call(
        performMinCut,
        sourceAgglomerateId,
        targetAgglomerateId,
        [sourceInfo.unmappedId],
        [targetInfo.unmappedId],
        agglomerateFileMag,
        volumeTracingId,
        sourceTree,
        annotationVersion,
        items,
      );
      if (hasErrored) {
        return;
      }
    }

    if (items.length === 0) {
      return;
    }

    yield* call(pushPendingProofreadingOperationInfo, volumeTracingId, sourceInfo, targetInfo);
    yield* put(pushSaveQueueTransaction(items));
    const postProcessResult = yield* call(
      syncAndUpdatePostProcessingInfo,
      sourceInfo,
      targetInfo,
      ctx,
    );
    if (!postProcessResult) return;
    ({ sourceInfo, targetInfo } = postProcessResult);

    activeMapping = yield* select(
      (store) => store.temporaryConfiguration.activeMappingByLayer[volumeTracing.tracingId],
    );
    sourceAgglomerateId = lookupAgglomerateId(
      activeMapping,
      sourceInfo.unmappedId,
      sourceAgglomerateId,
    );
    targetAgglomerateId = lookupAgglomerateId(
      activeMapping,
      targetInfo.unmappedId,
      targetAgglomerateId,
    );

    if (sourceAgglomerateId !== targetAgglomerateId) {
      Toast.error(
        "The selected positions are not part of the same agglomerate and cannot be split.",
      );
      return;
    }

    // Because we ensured a saved state a few lines above, we can now split the mapping locally
    // as this still requires some communication with the back-end.
    const currentAnnotationVersion = yield* select((state) => state.annotation.version);
    const splitMappingInfo = yield* splitAgglomerateInMapping(
      activeMapping,
      sourceAgglomerateId,
      [sourceInfo.unmappedId],
      volumeTracingId,
      currentAnnotationVersion,
      // No need to refresh the agglomerate meshes as this split is triggered by a previous
      // delete edge action, already correctly updating the agglomerate tree.
      false,
    );
    if (splitMappingInfo == null) {
      console.error("Failed to split mapping in tree based proofreading action. Aborting...");
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

    const [newSourceAgglomerateId, newTargetAgglomerateId] = yield* all([
      call(getDataValue, sourceNodePosition, mappingWithSplitApplied),
      call(getDataValue, targetNodePosition, mappingWithSplitApplied),
    ]);

    if (newSourceAgglomerateId === newTargetAgglomerateId) {
      // The split was unsuccessful.
      Toast.warning("The split operation was unsuccessful. Please retry.");
      yield* call(syncWithBackend, ctx);
      return;
    }

    let updatedSkeletonTracing = yield* select((state) => state.annotation.skeleton);
    if (!updatedSkeletonTracing) {
      Toast.error(
        "Could not reload skeleton tracing to update the tree names and refresh the auxiliary meshes after proofreading action via agglomerate trees.",
      );
      return;
    }

    // Reload trees as applying newest actions from the backend might have modified the skeleton.
    const updatedSourceTree = findTreeByNodeId(updatedSkeletonTracing.trees, sourceNodeId);
    const updatedTargetTree = findTreeByNodeId(updatedSkeletonTracing.trees, targetNodeId);

    if (updatedSourceTree == null || updatedTargetTree == null) {
      Toast.error("Couldn't find trees for nodes. Details are logged to the console.");
      console.error("Couldn't find trees for nodes. Details are logged to the console.", {
        sourceNodeId,
        updatedSourceTree,
        targetNodeId,
        updatedTargetTree,
      });
      return;
    }

    /* Rename agglomerate trees according to their new ids and mapping name */
    yield* put(
      setTreeNameAction(
        getTreeNameForAgglomerateTree(newSourceAgglomerateId, volumeTracing.mappingName),
        updatedSourceTree.treeId,
      ),
    );
    yield* put(setTreeAgglomerateInfoIdAction(newSourceAgglomerateId, updatedSourceTree.treeId));
    // A split happened: rename the target tree and create a segment for it.
    yield* put(
      setTreeNameAction(
        getTreeNameForAgglomerateTree(newTargetAgglomerateId, volumeTracing.mappingName),
        updatedTargetTree.treeId,
      ),
    );
    yield* put(setTreeAgglomerateInfoIdAction(newTargetAgglomerateId, updatedTargetTree.treeId));
    const newSegmentName =
      (yield* select(
        (state) =>
          getVolumeTracingById(state.annotation, volumeTracingId).segments.getNullable(
            sourceInfo.agglomerateId,
          )?.name,
      )) ?? `Agglomerate ${newTargetAgglomerateId}`;
    yield* put(
      updateSegmentAction(
        Number(newTargetAgglomerateId),
        { name: newSegmentName },
        volumeTracingId,
      ),
    );

    /* Ensure segment items exist for affected segments and reload affected meshes */
    const refreshInfos = [
      {
        oldAgglomerateId: sourceInfo.agglomerateId,
        newAgglomerateId: newSourceAgglomerateId,
        nodePosition: sourceNodePosition,
      },
      {
        oldAgglomerateId: targetInfo.agglomerateId,
        newAgglomerateId: newTargetAgglomerateId,
        nodePosition: targetNodePosition,
      },
    ];
    yield* call(refreshAffectedSegmentItems, volumeTracingId, refreshInfos);
    // Now that the segment items are up-to-date we can sync with the back-end and release the mutex.
    yield* call(syncWithBackend, ctx);

    // Refreshing the meshes might take a while and won't block the saga here.
    yield* spawnUntilCanceled(maybeRefreshAffectedMeshes, volumeTracingId, refreshInfos);
  } finally {
    if (unsubscribeFromAnnotationMutex) {
      yield* call(unsubscribeFromAnnotationMutex);
    }
  }
}
