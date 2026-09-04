import processTaskWithPool from "libs/async/task_pool";
import window from "libs/window";
import { uniq } from "lodash-es";
import uniqBy from "lodash-es/uniqBy";
import { all, call, put } from "typed-redux-saga";
import type { AdditionalCoordinate, APIMeshFileInfo } from "types/api_types";
import Constants, { type Vector3 } from "viewer/constants";
import { getLayerByName, getMappingInfo } from "viewer/model/accessors/dataset_accessor";
import { getMeshInfoForSegment, isMeshLoaded } from "viewer/model/accessors/volumetracing_accessor";
import {
  dispatchMaybeFetchMeshFilesAsync,
  removeMeshAction,
} from "viewer/model/actions/annotation_actions";
import {
  loadAdHocMeshAction,
  loadPrecomputedMeshAction,
} from "viewer/model/actions/segmentation_actions";
import {
  clickSegmentAction,
  removeSegmentAction,
} from "viewer/model/actions/volumetracing_actions";
import type { Saga } from "viewer/model/sagas/effect_generators";
import { select } from "viewer/model/sagas/effect_generators";
import { Store } from "viewer/singletons";
import type { OperationContext } from "../../operation_context_saga";
import { syncWithBackend } from "./backend_sync_helper_sagas";
import {
  detectMergeAndSplitChanges,
  tryLocalMeshMerge,
  trySplitMeshLocally,
} from "./local_mesh_change_sagas";
import { scheduleMeshUpdate } from "./mesh_update_registry_saga";
import type {
  AgglomerateChangeItem,
  IdInfo,
  IdInfoOpt,
  PreservedMeshDisplayProps,
} from "./proofreading_types";

function proofreadCoarseMagIndex(): number {
  // @ts-expect-error
  return window.__proofreadCoarseResolutionIndex != null
    ? // @ts-expect-error
      window.__proofreadCoarseResolutionIndex
    : 3;
}

// A mapping-less, formatVersion >= 3 mesh file can be meshed per-supervoxel on the fly for any
// mapping (see loadPrecomputedMeshForSegmentId in precomputed_mesh_saga.ts), which is what makes
// the local merge/split editing in this file possible in the first place - ad-hoc meshes carry no
// per-supervoxel tagging at all. Picks the first matching file, mirroring how
// maybeFetchMeshFiles/maybeActivateMeshFile auto-activates the first available file when none is
// selected yet.
function findPreferredPrecomputedMeshFile(
  availableMeshFiles: APIMeshFileInfo[],
): APIMeshFileInfo | undefined {
  return availableMeshFiles.find((file) => file.formatVersion >= 3 && file.mappingName == null);
}

export function* ensureSegmentItemAndMaybeLoadCoarseMesh(
  layerName: string,
  segmentId: bigint,
  position: Vector3,
  additionalCoordinates: AdditionalCoordinate[] | undefined,
): Saga<void> {
  yield* call(ensureSegmentItem, layerName, segmentId, position, additionalCoordinates);
  const autoRenderMeshInProofreading = yield* select(
    (state) => state.userConfiguration.autoRenderMeshInProofreading,
  );
  if (!autoRenderMeshInProofreading) {
    return;
  }
  yield* call(loadCoarseMesh, layerName, segmentId, position, additionalCoordinates);
}

function* ensureSegmentItem(
  layerName: string,
  segmentId: bigint,
  position: Vector3,
  additionalCoordinates: AdditionalCoordinate[] | undefined,
): Saga<void> {
  yield* put(clickSegmentAction(segmentId, position, additionalCoordinates, layerName));
}

function* loadCoarseMesh(
  layerName: string,
  segmentId: bigint,
  position: Vector3,
  additionalCoordinates: AdditionalCoordinate[] | undefined,
  opacity?: number,
  isVisible?: boolean,
): Saga<void> {
  const dataset = yield* select((state) => state.dataset);
  const layer = getLayerByName(dataset, layerName);

  // Ensure that potential mesh files are already available. Otherwise, the following
  // code would default to ad-hoc meshing.
  yield* call(dispatchMaybeFetchMeshFilesAsync, Store.dispatch, layer, dataset, false);

  const currentMeshFile = yield* select(
    (state) => state.localSegmentationStateByLayer[layerName].currentMeshFile,
  );

  const meshInfo = yield* select((state) =>
    getMeshInfoForSegment(state, additionalCoordinates || null, layerName, segmentId),
  );

  if (meshInfo != null) {
    console.log(`Don't load mesh for segment ${segmentId} because it already exists.`);
    return;
  }

  if (
    currentMeshFile != null &&
    currentMeshFile.formatVersion >= 3 &&
    currentMeshFile.mappingName == null
  ) {
    // If a mesh file is active which was computed without a mapping, use that instead of computing
    // meshes ad-hoc.
    yield* put(
      loadPrecomputedMeshAction(
        segmentId,
        position,
        additionalCoordinates,
        currentMeshFile.name,
        opacity,
        isVisible,
        undefined,
      ),
    );
  } else {
    const mappingInfo = yield* select((state) =>
      getMappingInfo(state.temporaryConfiguration.activeMappingByLayer, layerName),
    );
    const { mappingName, mappingType } = mappingInfo;

    // Load the whole agglomerate mesh in a coarse mag for performance reasons
    const preferredQuality = proofreadCoarseMagIndex();
    yield* put(
      loadAdHocMeshAction(segmentId, position, additionalCoordinates, {
        mappingName,
        mappingType,
        preferredQuality,
        opacity,
        isVisible,
      }),
    );
  }
}

export function* updateProofreadingSegmentsAndScheduleSyncMeshes(
  volumeTracingId: string,
  sourceInfo: IdInfo,
  targetInfo: IdInfoOpt,
  sourceAgglomerateId: bigint,
  targetAgglomerateId: bigint,
  ctx: OperationContext,
): Saga<void> {
  /* Ensure segment items exist for affected segments and reload affected meshes */
  const refreshInfos = [
    {
      oldAgglomerateId: sourceInfo.agglomerateId,
      newAgglomerateId: sourceAgglomerateId,
      nodePosition: sourceInfo.position,
    },
    {
      oldAgglomerateId: targetInfo.agglomerateId,
      newAgglomerateId: targetAgglomerateId,
      nodePosition:
        // targetInfo.position can only be undefined in case of
        // a merge (see idInfos.type). In that case,
        // this element was merged into another element.
        // Therefore, sourceInfo.position is a valid replacement.
        targetInfo.position ?? sourceInfo.position,
    },
  ];
  yield* call(updateAffectedSegmentItems, volumeTracingId, refreshInfos);
  yield* call(syncWithBackend, ctx);

  // Refreshing the meshes might take a while and won't block the saga here. A still-running mesh
  // update for an overlapping agglomerate id (e.g. the previous proofreading action's, if the user
  // is proofreading faster than meshes can reload) is superseded - see
  // mesh_update_registry_saga.ts.
  const meshUpdateEffect = call(
    syncAffectedAndMaybeLoadMissingMeshes,
    volumeTracingId,
    refreshInfos,
  );
  yield* call(scheduleMeshUpdate, meshUpdateEffect, volumeTracingId, refreshInfos);
}

export function* updateAffectedSegmentItems(
  layerName: string,
  items: Array<{
    oldAgglomerateId?: bigint;
    newAgglomerateId: bigint;
    nodePosition: Vector3;
  }>,
) {
  // Segmentations with more than 3 dimensions are currently not compatible
  // with proofreading. Once such datasets appear, this parameter needs to be
  // adapted.
  const additionalCoordinates = undefined;
  // Remove old segments which are no longer present.
  const outdatedIds = uniq(items.map((item) => item.oldAgglomerateId)).filter((id) => id != null);
  const itemsToAddOrUpdate = uniqBy(items, (item) => item.newAgglomerateId);
  const removedIds = new Set(outdatedIds).difference(
    new Set(itemsToAddOrUpdate.map((item) => item.newAgglomerateId)),
  );
  const removeEffects = [...removedIds].map((id) => put(removeSegmentAction(id, layerName)));
  yield* all(removeEffects);

  const ensureSegmentItemEffects = uniqBy(items, (item) => item.newAgglomerateId).map((item) =>
    call(
      ensureSegmentItem,
      layerName,
      item.newAgglomerateId,
      item.nodePosition,
      additionalCoordinates,
    ),
  );
  // By using `all`, we avoid problems which can occur when running too many
  // call effects in a for loop. Also see https://github.com/redux-saga/redux-saga/issues/1592.
  yield* all(ensureSegmentItemEffects);
}

export function* shouldReloadMeshesAfterProofreadAction(
  layerName: string,
  oldAgglomerateIds: bigint[],
): Saga<boolean> {
  const autoRenderMeshInProofreading = yield* select(
    (state) => state.userConfiguration.autoRenderMeshInProofreading,
  );
  if (autoRenderMeshInProofreading) {
    return true;
  }
  const hasAnyInvolvedMeshLoaded = yield* select((state) =>
    oldAgglomerateIds.some((id) => isMeshLoaded(state, id, layerName)),
  );
  return hasAnyInvolvedMeshLoaded;
}

// Capture the current opacity and visibility of the given old agglomerates' meshes, keyed by
// agglomerate id, so that reloaded meshes can keep the user-chosen opacity and visibility.
// Duplicate and nullish ids are ignored, so callers can pass the raw oldAgglomerateId of every
// item even when several share the same id (e.g. a split produces two pieces from the same
// original agglomerate). Callers must invoke this before any old mesh is removed, otherwise the
// original mesh display properties can no longer be read.
export function* getMeshDisplayPropsByOldAgglomerateId(
  layerName: string,
  oldAgglomerateIds: Iterable<bigint | null | undefined>,
  additionalCoordinates: AdditionalCoordinate[] | null | undefined,
): Saga<Map<bigint, PreservedMeshDisplayProps>> {
  return yield* select((state) => {
    const displayPropsByAgglomerateId = new Map<bigint, PreservedMeshDisplayProps>();
    for (const oldAgglomerateId of oldAgglomerateIds) {
      if (oldAgglomerateId != null && !displayPropsByAgglomerateId.has(oldAgglomerateId)) {
        const meshInfo = getMeshInfoForSegment(
          state,
          additionalCoordinates || null,
          layerName,
          oldAgglomerateId,
        );
        if (meshInfo != null) {
          displayPropsByAgglomerateId.set(oldAgglomerateId, {
            opacity: meshInfo.opacity,
            isVisible: meshInfo.isVisible,
          });
        }
      }
    }
    return displayPropsByAgglomerateId;
  });
}

export function* syncAffectedAndMaybeLoadMissingMeshes(
  layerName: string,
  items: AgglomerateChangeItem[],
): Saga<void> {
  const oldAgglomerateIds = items.map((item) => item.oldAgglomerateId).filter((id) => id != null);
  const shouldDoMeshRefreshing = yield* call(
    shouldReloadMeshesAfterProofreadAction,
    layerName,
    oldAgglomerateIds,
  );
  if (shouldDoMeshRefreshing) {
    // syncAffectedAndMaybeLoadMissingMeshes is itself always invoked as a detached, cancellable task via
    // scheduleMeshUpdate (see callers), so no separate spawn is needed here to avoid blocking.
    yield* call(syncAffectedAndLoadMissingMeshes, layerName, items);
  }
}

// Hard-reloads every item that couldn't be handled locally (no merge/split shape detected in the
// first place, or the local attempt failed): removes the old mesh(es) and loads the new one(s)
// fresh, same as before this feature existed. Kept as its own function, separate from the local
// merge/split attempts in syncAffectedAndLoadMissingMeshes, so the "give up and reload" path reads
// as one clearly-named step instead of being buried at the end of a much longer function.
//
// Exported so parked_pooled_local_mesh_change_scheduler.ts's alternate orchestrator can reuse it
// without duplicating it - see that file for context.
export function* reloadMeshes(
  layerName: string,
  itemsToReload: AgglomerateChangeItem[],
  displayPropsByOldAgglomerateId: Map<bigint, PreservedMeshDisplayProps>,
  additionalCoordinates: AdditionalCoordinate[] | undefined,
): Saga<void> {
  // Remember which meshes were removed in this saga
  // and which were fetched again to avoid doing redundant work.
  const removedIds = new Set();
  const newlyLoadedIds = new Set();
  const meshLoadingEffects: Array<() => Saga<void>> = [];
  for (const item of itemsToReload) {
    // Opacity and visibility are either passed in explicitly (e.g. by the rebasing saga, which
    // removes the old mesh before this saga runs) or taken from the old mesh captured above.
    const oldDisplayProps =
      item.oldAgglomerateId != null
        ? displayPropsByOldAgglomerateId.get(item.oldAgglomerateId)
        : undefined;
    const opacity = item.opacity ?? oldDisplayProps?.opacity;
    const isVisible = item.isVisible ?? oldDisplayProps?.isVisible;
    // Remove old agglomerate mesh(es) and load updated agglomerate mesh(es)
    if (item.oldAgglomerateId && !removedIds.has(item.oldAgglomerateId)) {
      yield* put(removeMeshAction(layerName, item.oldAgglomerateId));
      removedIds.add(item.oldAgglomerateId);
    }
    if (!newlyLoadedIds.has(item.newAgglomerateId)) {
      meshLoadingEffects.push(function* load() {
        yield* call(
          loadCoarseMesh,
          layerName,
          item.newAgglomerateId,
          item.nodePosition,
          additionalCoordinates,
          opacity,
          isVisible,
        );
      });
      newlyLoadedIds.add(item.newAgglomerateId);
    }
  }
  // Do all mesh loadings in parallel for more speed.
  yield* call(
    processTaskWithPool,
    meshLoadingEffects,
    Constants.PARALLEL_PRECOMPUTED_MESH_LOADING_COUNT,
  );
}

export function* syncAffectedAndLoadMissingMeshes(
  layerName: string,
  changeInfoItems: AgglomerateChangeItem[],
): Saga<void> {
  // ATTENTION: This saga should usually be called with `spawnUntilCanceled` to avoid that the user
  // is blocked (via takeEveryUnlessBusy) while the meshes are refreshed.

  // Segmentations with more than 3 dimensions are currently not compatible
  // with proofreading. Once such datasets appear, this parameter needs to be
  // adapted.
  const additionalCoordinates = undefined;

  // Capture the opacity and visibility of all old meshes up front, i.e. before any of them are
  // removed below, so that reloaded meshes keep the user-chosen opacity and visibility. This must
  // happen before the removal loop because removing one item's old mesh must not prevent another
  // item from reading the original properties.
  const oldAgglomerateIds = changeInfoItems
    .map((item) => item.oldAgglomerateId)
    .filter((id) => id != null);
  const displayPropsByOldAgglomerateId = yield* call(
    getMeshDisplayPropsByOldAgglomerateId,
    layerName,
    oldAgglomerateIds,
    additionalCoordinates,
  );

  const { mergeGroups, splitGroups, remainingItems } = detectMergeAndSplitChanges(changeInfoItems);

  // Try to splice already-loaded meshes together locally instead of removing and reloading them.
  // Groups whose merge attempt didn't fully succeed (e.g. mixed ad-hoc/precomputed meshes, or
  // nothing loaded to splice) fall through to the reload loop below. Merge groups run one after
  // another rather than in parallel - see parked_pooled_local_mesh_change_scheduler.ts for a
  // parallel/dependency-aware alternative that was parked as too complex for now.
  const itemsToReload: AgglomerateChangeItem[] = [...remainingItems];
  for (const { newAgglomerateId, oldIds, items } of mergeGroups) {
    const handledLocally = yield* call(
      tryLocalMeshMerge,
      layerName,
      oldIds,
      newAgglomerateId,
      additionalCoordinates,
    );
    if (!handledLocally) itemsToReload.push(...items);
  }

  // Try to split an already-loaded mesh locally instead of removing and reloading it. Groups whose
  // split attempt didn't fully succeed (no precomputed mesh loaded, or its supervoxels couldn't be
  // confidently classified) fall through to the reload loop below. Also runs sequentially - see the
  // note above.
  for (const { oldAgglomerateId, newIds, items } of splitGroups) {
    const handledLocally = yield* call(
      trySplitMeshLocally,
      layerName,
      oldAgglomerateId,
      newIds,
      additionalCoordinates,
    );
    if (!handledLocally) itemsToReload.push(...items);
  }

  if (itemsToReload.length === 0) return;

  yield* call(
    reloadMeshes,
    layerName,
    itemsToReload,
    displayPropsByOldAgglomerateId,
    additionalCoordinates,
  );
}
