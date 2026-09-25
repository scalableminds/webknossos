import processTaskWithPool from "libs/async/task_pool";
import window from "libs/window";
import { uniq } from "lodash-es";
import uniqBy from "lodash-es/uniqBy";
import { all, call, put } from "typed-redux-saga";
import type { AdditionalCoordinate } from "types/api_types";
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
import { spawnUntilCanceled } from "../../saga_helpers";
import { syncWithBackend } from "./backend_sync_helper_sagas";
import type { AgglomerateChangeItem, PreservedMeshDisplayProps } from "./proofreading_types";

function proofreadCoarseMagIndex(): number {
  // @ts-expect-error
  return window.__proofreadCoarseResolutionIndex != null
    ? // @ts-expect-error
      window.__proofreadCoarseResolutionIndex
    : 3;
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

/*
 * Shared tail of all proofreading handlers: updates the segment items of the affected agglomerate
 * ids, syncs with the back-end and refreshes the affected meshes. The refresh is a normal mesh
 * reload. Its chunks mostly come from the browser-side cache in mesh_chunk_provider.ts, so a reload
 * after a merge or split needs only few requests. The refreshInfos are built by each caller, as
 * their shape differs per operation.
 */
export function* refreshProofreadingSegmentsAndMeshes(
  volumeTracingId: string,
  refreshInfos: AgglomerateChangeItem[],
  ctx: OperationContext,
): Saga<void> {
  // Segmentations with more than 3 dimensions are currently not compatible
  // with proofreading. Once such datasets appear, this parameter needs to be
  // adapted.
  const additionalCoordinates = undefined;
  const oldAgglomerateIds = refreshInfos
    .map((item) => item.oldAgglomerateId)
    .filter((id) => id != null);
  // Both must be read before the segment items are updated, because removing an outdated segment
  // item also removes its mesh.
  const shouldRefreshMeshes = yield* call(
    shouldReloadMeshesAfterProofreadAction,
    volumeTracingId,
    oldAgglomerateIds,
  );
  const displayPropsByOldAgglomerateId = yield* call(
    getMeshDisplayPropsByOldAgglomerateId,
    volumeTracingId,
    oldAgglomerateIds,
    additionalCoordinates,
  );

  yield* call(refreshAffectedSegmentItems, volumeTracingId, refreshInfos);
  // Now that the segment items are up-to-date we can sync with the back-end and release the mutex.
  yield* call(syncWithBackend, ctx);

  if (shouldRefreshMeshes) {
    // Refreshing the meshes might take a while and won't block the saga here.
    yield* spawnUntilCanceled(
      refreshAffectedMeshes,
      volumeTracingId,
      withDisplayPropsOfOldMeshes(refreshInfos, displayPropsByOldAgglomerateId),
    );
  }
}

// Explicitly passed opacity and visibility take precedence over the ones of the old mesh.
function withDisplayPropsOfOldMeshes(
  items: AgglomerateChangeItem[],
  displayPropsByOldAgglomerateId: Map<bigint, PreservedMeshDisplayProps>,
): AgglomerateChangeItem[] {
  return items.map((item) => {
    const oldDisplayProps =
      item.oldAgglomerateId != null
        ? displayPropsByOldAgglomerateId.get(item.oldAgglomerateId)
        : undefined;
    return {
      ...item,
      opacity: item.opacity ?? oldDisplayProps?.opacity,
      isVisible: item.isVisible ?? oldDisplayProps?.isVisible,
    };
  });
}

function* refreshAffectedSegmentItems(layerName: string, items: AgglomerateChangeItem[]) {
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

function* shouldReloadMeshesAfterProofreadAction(
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

export function* refreshAffectedMeshes(layerName: string, items: AgglomerateChangeItem[]) {
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
  const displayPropsByOldAgglomerateId = yield* call(
    getMeshDisplayPropsByOldAgglomerateId,
    layerName,
    items.map((item) => item.oldAgglomerateId),
    additionalCoordinates,
  );

  // Remember which meshes were removed in this saga
  // and which were fetched again to avoid doing redundant work.
  const removedIds = new Set();
  const newlyLoadedIds = new Set();
  const meshLoadingEffects = [];
  for (const item of items) {
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
