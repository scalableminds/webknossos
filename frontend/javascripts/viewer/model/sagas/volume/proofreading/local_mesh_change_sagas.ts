// Local, network-round-trip-avoiding handling of proofreading merges and splits: patching an
// already-loaded mesh's scene-graph/geometry directly instead of removing and reloading it (see
// segment_and_mesh_refresh_sagas.ts's reloadMeshes for that fallback path, and
// syncAffectedAndLoadMissingMeshes for how the two are combined). Split out into its own module
// since this is a cohesive, self-contained algorithm - detection, merge, and split - that doesn't
// otherwise touch initial mesh loading or segment-item bookkeeping.

import { getAgglomeratesForSegmentsFromTracingstore, type meshApi } from "admin/rest_api";
import { uniq } from "lodash-es";
import type { ActionPattern } from "redux-saga/effects";
import { call, put, take } from "typed-redux-saga";
import type { AdditionalCoordinate } from "types/api_types";
import getSceneController from "viewer/controller/scene_controller_provider";
import { getSegmentationLayerByName } from "viewer/model/accessors/dataset_accessor";
import { getMeshInfoForSegment } from "viewer/model/accessors/volumetracing_accessor";
import type { Action } from "viewer/model/actions/actions";
import {
  dispatchMaybeFetchMeshFilesAsync,
  mergeMeshesAction,
  splitMeshAction,
} from "viewer/model/actions/annotation_actions";
import type { Saga } from "viewer/model/sagas/effect_generators";
import { select } from "viewer/model/sagas/effect_generators";
import {
  _getChunkLoadingDescriptors,
  fetchAndMergePrecomputedChunks,
} from "viewer/model/sagas/meshes/precomputed_mesh_saga";
import { Store } from "viewer/singletons";
import type {
  ActiveMappingInfo,
  Mapping,
  MeshInformation,
  PrecomputedMeshInformation,
} from "viewer/store";
import { getMappedIdAsBigInt } from "./preparation_sagas";
import type { AgglomerateChangeItem } from "./proofreading_types";

// Waits until segmentId's mesh has finished loading (if it's currently loading at all) before
// returning. Used before any local scene-graph surgery (relabeling/splicing/splitting), since the
// per-chunk loading sagas reference the segment id directly throughout their run - touching the
// scene graph mid-flight would orphan whatever chunks arrive afterward.
export function* waitForMeshFullyLoaded(
  layerName: string,
  segmentId: bigint,
  additionalCoordinates?: AdditionalCoordinate[] | null,
): Saga<void> {
  const isLoading = yield* select(
    (state) =>
      getMeshInfoForSegment(state, additionalCoordinates ?? null, layerName, segmentId)
        ?.isLoading ?? false,
  );
  if (!isLoading) return;
  yield* take(
    ((action: Action) =>
      action.type === "FINISHED_LOADING_MESH" &&
      action.layerName === layerName &&
      action.segmentId === segmentId) as ActionPattern,
  );
}

// Thin wrapper around _getChunkLoadingDescriptors that turns a failure (e.g. the backend
// couldn't resolve the agglomerate, or a network error) into a null return instead of a thrown
// exception, so callers can use plain type inference on the result instead of having to spell
// out the generator's return type themselves.
function* safeGetChunkLoadingDescriptors(...args: Parameters<typeof _getChunkLoadingDescriptors>) {
  try {
    return yield* call(_getChunkLoadingDescriptors, ...args);
  } catch (exception) {
    console.warn(`Could not list mesh chunks for agglomerate ${args[0]}:`, exception);
    return null;
  }
}

// Fetches only the mesh-file chunks that are missing from oldId's already-loaded geometry -
// i.e. the ones belonging to the not-yet-loaded side of a merge - by listing newId's full,
// current chunk set (the backend resolves the merged agglomerate id to all of its member
// supervoxels) and diffing it against what's already loaded under oldId, per LOD. Appends the
// fetched chunks to oldId's existing scene-graph entry (the caller relabels oldId -> newId
// afterwards). Returns false (nothing mutated for this side, but not a hard failure) if the
// chunk listing itself couldn't be resolved - the caller then falls back to a full reload.
function* fetchAndAppendMissingPrecomputedMergeChunks(
  layerName: string,
  oldId: bigint,
  newId: bigint,
  meshInfo: PrecomputedMeshInformation,
  additionalCoordinates: AdditionalCoordinate[] | undefined,
): Saga<boolean> {
  const { segmentMeshController } = yield* call(getSceneController);
  const dataset = yield* select((state) => state.dataset);
  const segmentationLayer = yield* select((state) =>
    getSegmentationLayerByName(state.dataset, layerName),
  );
  if (segmentationLayer == null) return false;

  const availableMeshFiles = yield* call(
    dispatchMaybeFetchMeshFilesAsync,
    Store.dispatch,
    segmentationLayer,
    dataset,
    false,
    false,
  );
  const meshFile = availableMeshFiles.find((file) => file.name === meshInfo.meshFileName);
  if (meshFile == null) return false;

  const annotationVersion = yield* select((state) => state.annotation.version);
  const chunkDescriptors = yield* call(
    safeGetChunkLoadingDescriptors,
    newId,
    dataset,
    segmentationLayer,
    meshFile,
    annotationVersion,
  );
  if (chunkDescriptors == null) return false;

  const loadedLods = segmentMeshController.getLoadedLods(oldId, layerName, additionalCoordinates);
  for (const lod of loadedLods) {
    const allChunksForLod = chunkDescriptors.availableChunksMap[lod] as
      | meshApi.MeshChunk[]
      | null
      | undefined;
    if (allChunksForLod == null) continue;
    const alreadyLoadedIds = segmentMeshController.getLoadedUnmappedSegmentIds(
      oldId,
      layerName,
      lod,
      additionalCoordinates,
    );
    const deltaChunks = allChunksForLod.filter(
      (chunk) => !alreadyLoadedIds.has(chunk.unmappedSegmentId),
    );
    if (deltaChunks.length === 0) continue;

    const mergedDeltaGeometry = yield* call(
      fetchAndMergePrecomputedChunks,
      dataset,
      meshFile,
      segmentationLayer,
      newId,
      deltaChunks,
      chunkDescriptors.segmentInfo.chunkScale,
    );
    if (mergedDeltaGeometry == null) continue;

    // This adds the delta as a second sibling node next to oldId's existing merged node instead
    // of folding them into one - tryLocalMeshMerge consolidates them back down (see
    // consolidateMergedMesh below) once oldId has been relabeled to newId.
    yield* call(
      {
        context: segmentMeshController,
        fn: segmentMeshController.addMeshFromGeometry,
      },
      mergedDeltaGeometry,
      oldId,
      null,
      lod,
      layerName,
      additionalCoordinates,
      meshInfo.opacity,
      true,
    );
  }
  return true;
}

// Consolidates newId's mesh back down to a single node per LOD after a local merge spread it
// across sibling nodes (moveMeshesToNewSegmentId only reparents chunk groups, it doesn't re-merge
// their geometries; fetchAndAppendMissingPrecomputedMergeChunks appends a delta as another
// sibling for the same reason). No-op for ad-hoc meshes or a precomputed mesh that fell back to
// unmerged chunks - see SegmentMeshController.consolidateMeshGroups for the actual algorithm.
function* consolidateMergedMesh(
  layerName: string,
  newId: bigint,
  additionalCoordinates: AdditionalCoordinate[] | undefined,
): Saga<void> {
  const { segmentMeshController } = yield* call(getSceneController);
  const opacity = yield* select(
    (state) =>
      getMeshInfoForSegment(state, additionalCoordinates ?? null, layerName, newId)?.opacity,
  );
  yield* call(
    { context: segmentMeshController, fn: segmentMeshController.consolidateMeshGroups },
    newId,
    layerName,
    opacity,
    additionalCoordinates,
  );
}

// Tries to splice oldIds' already-loaded meshes together locally under newId, instead of
// removing and reloading them (the pattern a proofreading merge produces: 2+ old agglomerate ids
// collapsing into 1 new one). Returns true if it fully handled the merge locally (the caller
// should skip the normal remove+reload for these items); false if the caller should fall back to
// the normal reload path (nothing was loaded to splice, or the loaded sides are different mesh
// types - see the module-level docs in the plan for why mixed types aren't spliced).
export function* tryLocalMeshMerge(
  layerName: string,
  oldIds: bigint[],
  newId: bigint,
  additionalCoordinates: AdditionalCoordinate[] | undefined,
): Saga<boolean> {
  for (const oldId of oldIds) {
    yield* call(waitForMeshFullyLoaded, layerName, oldId, additionalCoordinates);
  }

  const meshInfos = yield* select((state) =>
    oldIds.map((oldId) =>
      getMeshInfoForSegment(state, additionalCoordinates ?? null, layerName, oldId),
    ),
  );
  const oldIdsWithMeshInfo = oldIds
    .map((oldId, index) => ({ oldId, meshInfo: meshInfos[index] }))
    .filter(
      (entry): entry is { oldId: bigint; meshInfo: MeshInformation } => entry.meshInfo != null,
    );

  if (oldIdsWithMeshInfo.length === 0) {
    // Nothing loaded for any side: nothing to preserve. Defer to reload path.
    return false;
  }

  const { segmentMeshController } = yield* call(getSceneController);

  if (oldIdsWithMeshInfo.length === 1) {
    const { oldId, meshInfo } = oldIdsWithMeshInfo[0];
    if (meshInfo.isPrecomputed) {
      const handled = yield* call(
        fetchAndAppendMissingPrecomputedMergeChunks,
        layerName,
        oldId,
        newId,
        meshInfo,
        additionalCoordinates,
      );
      if (!handled) {
        return false;
      }
    }
    // Ad-hoc mesh (no supervoxel tagging, so there's no delta to fetch): still avoid a full
    // reload by just relabeling what's loaded onto the merged id.
    segmentMeshController.moveMeshesToNewSegmentId(oldId, newId, layerName, additionalCoordinates);
    yield* put(mergeMeshesAction(layerName, oldId, newId, additionalCoordinates));
    segmentMeshController.setMeshColor(newId, layerName);
    yield* call(consolidateMergedMesh, layerName, newId, additionalCoordinates);
    return true;
  }

  // Two (or more) sides loaded: only splice locally if every side is the same mesh type. Mixing a
  // precomputed mesh's oversegmentation info with an untagged ad-hoc mesh isn't representable by a
  // single MeshInformation entry, and discarding the precomputed side's tagging to make them match
  // would work against the goal of keeping meshes precomputed whenever possible.
  const allSameType = oldIdsWithMeshInfo.every(
    (entry) => entry.meshInfo.isPrecomputed === oldIdsWithMeshInfo[0].meshInfo.isPrecomputed,
  );
  if (!allSameType) {
    return false;
  }

  // moveMeshesToNewSegmentId only reparents each side's chunk groups under newId - it doesn't
  // re-merge their geometries, so newId ends up with one sibling MeshSceneNode per loaded old
  // side. consolidateMergedMesh below folds them back into a single merged node/geometry per LOD.
  for (const { oldId } of oldIdsWithMeshInfo) {
    segmentMeshController.moveMeshesToNewSegmentId(oldId, newId, layerName, additionalCoordinates);
    yield* put(mergeMeshesAction(layerName, oldId, newId, additionalCoordinates));
  }
  segmentMeshController.setMeshColor(newId, layerName);
  yield* call(consolidateMergedMesh, layerName, newId, additionalCoordinates);
  return true;
}

// Classifies each of `supervoxelIds` into whichever of `newIds` it now belongs to, after a split.
// Prefers the local (already up-to-date) mapping, which requires no network call; only for
// supervoxel ids missing there does it fall back to one bulk reverse-lookup request (agglomerates
// for these exact segment ids), regardless of how many new ids resulted from the split. Returns
// null (instead of a partial result) if any supervoxel id can't be confidently classified into one
// of `newIds`, since an incomplete/uncertain classification would produce visibly wrong geometry
// (missing or misplaced chunks) rather than just a slower reload.
function* getNewAgglomerateIdsToSegmentIdsMap(
  layerName: string,
  segmentIds: bigint[],
  newAgglomerateIds: Set<bigint>,
): Saga<Map<bigint, Set<bigint>> | null> {
  const newAgglomerateIdToSegmentIds = new Map<bigint, Set<bigint>>();
  for (const newId of newAgglomerateIds) {
    newAgglomerateIdToSegmentIds.set(newId, new Set());
  }

  const activeMapping = yield* select(
    (state): ActiveMappingInfo => state.temporaryConfiguration.activeMappingByLayer[layerName],
  );
  const unresolvedIds: bigint[] = [];
  for (const supervoxelId of segmentIds) {
    const mappedId =
      activeMapping.mapping != null
        ? getMappedIdAsBigInt(activeMapping.mapping, supervoxelId)
        : undefined;
    if (mappedId != null && newAgglomerateIdToSegmentIds.has(mappedId)) {
      newAgglomerateIdToSegmentIds.get(mappedId)?.add(supervoxelId);
    } else {
      unresolvedIds.push(supervoxelId);
    }
  }

  if (unresolvedIds.length > 0) {
    const tracingStoreUrl = yield* select((state) => state.annotation.tracingStore.url);
    const annotationId = yield* select((state) => state.annotation.annotationId);
    const annotationVersion = yield* select((state) => state.annotation.version);
    let resolvedMapping: Mapping;
    try {
      resolvedMapping = yield* call(
        getAgglomeratesForSegmentsFromTracingstore,
        tracingStoreUrl,
        layerName,
        new Set(unresolvedIds),
        annotationId,
        annotationVersion,
      );
    } catch (exception) {
      console.warn(
        `Could not resolve post-split agglomerate ids for ${unresolvedIds.length} supervoxel(s):`,
        exception,
      );
      return null;
    }
    for (const supervoxelId of unresolvedIds) {
      const mappedId = getMappedIdAsBigInt(resolvedMapping, supervoxelId);
      if (mappedId == null || !newAgglomerateIdToSegmentIds.has(mappedId)) {
        // Couldn't confidently map the segment ids to their respective new agglomerate ids.
        // -> Abort rather than produce a mesh with missing/misplaced chunks.
        return null;
      }
      newAgglomerateIdToSegmentIds.get(mappedId)?.add(supervoxelId);
    }
  }

  for (const keepIds of newAgglomerateIdToSegmentIds.values()) {
    // If any new agglomerate doesn't get any of the segment ids, things might be weird. Thus, better fallback to full reload.
    if (keepIds.size === 0) return null;
  }

  return newAgglomerateIdToSegmentIds;
}

// Tries to split oldId's already-loaded mesh locally into newIds, instead of removing and
// reloading it (the pattern a proofreading split produces: 1 old agglomerate id fanning out into
// 2+ new ones, including N-way splits like "split from all neighbours"). Returns true if it fully
// handled the split locally (the caller should skip the normal remove+reload for these items);
// false if the caller should fall back to the normal reload path (no precomputed mesh loaded for
// oldId, or its supervoxels couldn't be confidently classified).
export function* trySplitMeshLocally(
  layerName: string,
  oldId: bigint,
  newIds: bigint[],
  additionalCoordinates: AdditionalCoordinate[] | undefined,
): Saga<boolean> {
  yield* call(waitForMeshFullyLoaded, layerName, oldId, additionalCoordinates);

  const meshInfo = yield* select((state) =>
    getMeshInfoForSegment(state, additionalCoordinates ?? null, layerName, oldId),
  );
  if (meshInfo == null || !meshInfo.isPrecomputed) {
    // No mesh loaded, or an ad-hoc mesh (no supervoxel tagging): can't split locally.
    return false;
  }

  const { segmentMeshController } = yield* call(getSceneController);
  if (!segmentMeshController.canSplitMeshLocally(oldId, layerName, additionalCoordinates)) {
    return false;
  }

  const supervoxelIds = segmentMeshController.getAllLoadedUnmappedSegmentIds(
    oldId,
    layerName,
    additionalCoordinates,
  );
  const newAgglomerateIdToSegmentIds = yield* call(
    getNewAgglomerateIdsToSegmentIdsMap,
    layerName,
    [...supervoxelIds],
    new Set(newIds),
  );
  if (newAgglomerateIdToSegmentIds == null) return false;

  // Update Redux (and thus the new ids' isVisible, which addMeshFromGeometry reads when creating
  // their target groups) before touching the scene graph - canSplitMeshLocally already confirmed
  // the split itself will succeed, so there's no window where Redux and the scene could end up
  // inconsistent.
  yield* put(splitMeshAction(layerName, oldId, newIds, additionalCoordinates));

  const succeeded = yield* call(
    { context: segmentMeshController, fn: segmentMeshController.splitMeshByNewMapping },
    oldId,
    layerName,
    newAgglomerateIdToSegmentIds,
    meshInfo.opacity,
    additionalCoordinates,
  );
  if (!succeeded) {
    // Shouldn't happen given the canSplitMeshLocally check above, but guard against drift between
    // the two anyway rather than leaving Redux and the scene inconsistent.
    console.error(`splitMeshByUnmappedSegmentIds unexpectedly failed for segment ${oldId}.`);
    return false;
  }

  for (const newId of newIds) {
    segmentMeshController.setMeshColor(newId, layerName);
  }
  return true;
}

// Exported so the parked, currently-unused pooled/dependency-aware scheduler in
// parked_pooled_local_mesh_change_scheduler.ts can reuse this type without duplicating it - see
// that file for context on why it isn't wired in here.
export type MergeGroup = {
  newAgglomerateId: bigint;
  oldIds: bigint[];
  items: AgglomerateChangeItem[];
};
export type SplitGroup = {
  oldAgglomerateId: bigint;
  newIds: bigint[];
  items: AgglomerateChangeItem[];
};

// Detects merge- and split-shaped groups within a single batch of change items.
//
// Merge shape: 2+ distinct old agglomerate ids collapsing into the same new id (grouped by
// newAgglomerateId) - the pattern a proofreading merge produces.
// Split shape: 1 old agglomerate id fanning out into 2+ distinct new ids (grouped by
// oldAgglomerateId, among whatever isn't already part of a merge group) - the pattern a
// proofreading split produces, including N-way splits like "split from all neighbours".
//
// A single batch can legitimately contain both shapes at once - e.g. a local split's refreshInfos
// incorporating an interfering foreign merge action from the backend - so both are always detected
// together here, rather than being picked ahead of time based on which top-level proofreading
// action triggered the refresh (a boolean flag can't represent "this batch has both shapes").
//
// Known limitation: an item belonging to a merge group is never reconsidered for a split group,
// even if that merge later fails to apply locally (see syncAffectedAndLoadMissingMeshes in
// segment_and_mesh_refresh_sagas.ts) and a sibling item shares its old id with a different new id -
// that combination falls back to a plain reload instead of a local split. This should be rare
// enough in practice (it needs a failed merge *and* an unrelated split sharing the same old id, in
// the same batch) that it isn't worth re-running detection on the merge fallback's leftovers.
export function detectMergeAndSplitChanges(changeInfoItems: AgglomerateChangeItem[]): {
  mergeGroups: MergeGroup[];
  splitGroups: SplitGroup[];
  remainingItems: AgglomerateChangeItem[];
} {
  const itemsByNewId = new Map<bigint, AgglomerateChangeItem[]>();
  for (const item of changeInfoItems) {
    const group = itemsByNewId.get(item.newAgglomerateId);
    if (group != null) {
      group.push(item);
    } else {
      itemsByNewId.set(item.newAgglomerateId, [item]);
    }
  }

  const mergeGroups: MergeGroup[] = [];
  const nonMergeItems: AgglomerateChangeItem[] = [];
  for (const [newAgglomerateId, groupItems] of itemsByNewId) {
    const oldIds = uniq(groupItems.map((item) => item.oldAgglomerateId).filter((id) => id != null));
    if (oldIds.length >= 2) {
      mergeGroups.push({ newAgglomerateId, oldIds, items: groupItems });
    } else {
      nonMergeItems.push(...groupItems);
    }
  }

  const itemsByOldId = new Map<bigint, AgglomerateChangeItem[]>();
  const remainingItems: AgglomerateChangeItem[] = [];
  for (const item of nonMergeItems) {
    if (item.oldAgglomerateId == null) {
      remainingItems.push(item);
      continue;
    }
    const group = itemsByOldId.get(item.oldAgglomerateId);
    if (group != null) {
      group.push(item);
    } else {
      itemsByOldId.set(item.oldAgglomerateId, [item]);
    }
  }

  const splitGroups: SplitGroup[] = [];
  for (const [oldAgglomerateId, groupItems] of itemsByOldId) {
    const newIds = uniq(groupItems.map((item) => item.newAgglomerateId));
    if (newIds.length >= 2) {
      splitGroups.push({ oldAgglomerateId, newIds, items: groupItems });
    } else {
      remainingItems.push(...groupItems);
    }
  }

  return { mergeGroups, splitGroups, remainingItems };
}
