// Local, network-round-trip-avoiding handling of proofreading merges and splits: patching an
// already-loaded mesh's scene-graph/geometry directly instead of removing and reloading it (see
// segment_and_mesh_refresh_sagas.ts's reloadMeshes for that fallback path, and
// syncAffectedAndLoadMissingMeshes for how the two are combined). Split out into its own module
// since this is a cohesive, self-contained algorithm - detection, merge, and split - that doesn't
// otherwise touch initial mesh loading or segment-item bookkeeping.

import { getSegmentsForAgglomerateFromTracingStore, type meshApi } from "admin/rest_api";
import processTaskWithPool from "libs/async/task_pool";
import { uniq } from "lodash-es";
import type { ActionPattern } from "redux-saga/effects";
import { call, delay, put, race, take } from "typed-redux-saga";
import type { AdditionalCoordinate, APIMeshFileInfo } from "types/api_types";
import Constants, { type Vector3 } from "viewer/constants";
import getSceneController from "viewer/controller/scene_controller_provider";
import type SegmentMeshController from "viewer/controller/segment_mesh_controller";
import { getSegmentationLayerByName } from "viewer/model/accessors/dataset_accessor";
import { getMeshInfoForSegment } from "viewer/model/accessors/volumetracing_accessor";
import type { Action } from "viewer/model/actions/actions";
import {
  dispatchMaybeFetchMeshFilesAsync,
  mergeMeshesAction,
  removeMeshAction,
  splitMeshAction,
} from "viewer/model/actions/annotation_actions";
import type { Saga } from "viewer/model/sagas/effect_generators";
import { select } from "viewer/model/sagas/effect_generators";
import {
  fetchAndMergePrecomputedChunks,
  getChunkLoadingDescriptors,
  getChunksForUnmappedSegments,
} from "viewer/model/sagas/meshes/precomputed_mesh_saga";
import { Store } from "viewer/singletons";
import type { MeshInformation, PrecomputedMeshInformation } from "viewer/store";
import type { AgglomerateChangeItem } from "./proofreading_types";

// Safety net against a mesh load that never settles, e.g. because its saga was cancelled without
// dispatching anything. The mesh is loaded from scratch afterwards.
const MESH_LOADING_TIMEOUT_MS = 30000;

/*
 * Waits until segmentId's mesh is fully loaded. Returns false if the mesh was removed while loading
 * or did not settle in time. The mesh must not be adjusted locally then.
 */
export function* waitForMeshFullyLoaded(
  layerName: string,
  segmentId: bigint,
  additionalCoordinates?: AdditionalCoordinate[] | null,
): Saga<boolean> {
  const isLoading = yield* select(
    (state) =>
      getMeshInfoForSegment(state, additionalCoordinates ?? null, layerName, segmentId)
        ?.isLoading ?? false,
  );
  if (!isLoading) return true;

  const { finishedLoading } = yield* race({
    finishedLoading: take(
      ((action: Action) =>
        action.type === "FINISHED_LOADING_MESH" &&
        action.layerName === layerName &&
        action.segmentId === segmentId) as ActionPattern,
    ),
    removed: take(
      ((action: Action) =>
        action.type === "REMOVE_MESH" &&
        action.layerName === layerName &&
        action.segmentId === segmentId) as ActionPattern,
    ),
    timeout: delay(MESH_LOADING_TIMEOUT_MS),
  });
  return finishedLoading != null;
}

/*
 * Wraps getChunkLoadingDescriptors so that a failure becomes a null return instead of an exception.
 */
function* safeGetChunkLoadingDescriptors(...args: Parameters<typeof getChunkLoadingDescriptors>) {
  try {
    return yield* call(getChunkLoadingDescriptors, ...args);
  } catch (exception) {
    console.warn(`Could not list mesh chunks for agglomerate ${args[0]}:`, exception);
    return null;
  }
}

/*
 * Resolves the mesh file a mesh was actually loaded from. Falling back to the currently selected
 * file could mix geometry that was computed differently.
 */
function* getMeshFileOfLoadedMesh(
  layerName: string,
  meshInfo: PrecomputedMeshInformation,
): Saga<APIMeshFileInfo | null> {
  const dataset = yield* select((state) => state.dataset);
  const segmentationLayer = yield* select((state) =>
    getSegmentationLayerByName(state.dataset, layerName),
  );
  if (segmentationLayer == null) return null;

  const availableMeshFiles = yield* call(
    dispatchMaybeFetchMeshFilesAsync,
    Store.dispatch,
    segmentationLayer,
    dataset,
    false,
    false,
  );
  return availableMeshFiles.find((file) => file.name === meshInfo.meshFileName) ?? null;
}

/*
 * Fetches the given mesh chunks and adds them to targetId's scene group as a second geometry next
 * to the existing one. The two are folded into one by mergeMeshSiblingsIntoOneGeometry after a
 * merge, or taken apart again by splitMeshByNewMapping after a split.
 * Returns false if the chunks could not be fetched, so that callers can fall back to a full reload
 * instead of leaving the mesh incomplete.
 */
function* fetchAndAppendChunksToMesh(
  layerName: string,
  targetId: bigint,
  segmentIdForRequest: bigint,
  lod: number,
  chunks: meshApi.MeshChunk[],
  chunkScale: Vector3 | null,
  meshFile: APIMeshFileInfo,
  opacity: number | undefined,
  additionalCoordinates: AdditionalCoordinate[] | undefined,
): Saga<boolean> {
  if (chunks.length === 0) return true;

  const dataset = yield* select((state) => state.dataset);
  const segmentationLayer = yield* select((state) =>
    getSegmentationLayerByName(state.dataset, layerName),
  );
  if (segmentationLayer == null) return false;

  const mergedGeometry = yield* call(
    fetchAndMergePrecomputedChunks,
    dataset,
    meshFile,
    segmentationLayer,
    segmentIdForRequest,
    chunks,
    chunkScale,
  );
  if (mergedGeometry == null) return false;

  const { segmentMeshController } = yield* call(getSceneController);
  yield* call(
    {
      context: segmentMeshController,
      fn: segmentMeshController.addMeshFromGeometry,
    },
    mergedGeometry,
    targetId,
    null,
    lod,
    layerName,
    additionalCoordinates,
    opacity,
    true,
  );
  return true;
}

/*
 * Prepares a local merge in which only oldId has a mesh: lists the chunks of the merged agglomerate
 * newId, fetches those that are not part of oldId's geometry yet and appends them to oldId's group.
 * Returns false if the mesh cannot be completed, in which case a full reload is needed.
 */
function* fetchAndAppendMissingPrecomputedMergeChunks(
  layerName: string,
  oldId: bigint,
  newId: bigint,
  meshInfo: PrecomputedMeshInformation,
  additionalCoordinates: AdditionalCoordinate[] | undefined,
  annotationVersion: number,
): Saga<boolean> {
  const { segmentMeshController } = yield* call(getSceneController);
  if (!segmentMeshController.hasFullyMergedMesh(oldId, layerName, additionalCoordinates)) {
    return false;
  }

  const dataset = yield* select((state) => state.dataset);
  const segmentationLayer = yield* select((state) =>
    getSegmentationLayerByName(state.dataset, layerName),
  );
  if (segmentationLayer == null) return false;

  const meshFile = yield* call(getMeshFileOfLoadedMesh, layerName, meshInfo);
  if (meshFile == null) return false;

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
    const appended = yield* call(
      fetchAndAppendChunksToMesh,
      layerName,
      oldId,
      newId,
      lod,
      deltaChunks,
      chunkDescriptors.segmentInfo.chunkScale,
      meshFile,
      meshInfo.opacity,
      additionalCoordinates,
    );
    if (!appended) return false;
  }
  return true;
}

/*
 * Used to clean up a local merge by merging sibling mesh parts into one geometry.
 */
function* mergeMeshSiblingsIntoOneGeometry(
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
    { context: segmentMeshController, fn: segmentMeshController.mergeMeshSiblingsIntoOneGeometry },
    newId,
    layerName,
    opacity,
    additionalCoordinates,
  );
}

/*
 * Tries to locally merge precomputed based agglomerate meshes locally together to avoid a full reload.
 * Returns true if the merge was successfully locally handled; else false -> a full reload is needed.
 */
export function* tryLocalMeshMerge(
  layerName: string,
  oldIds: bigint[],
  newId: bigint,
  additionalCoordinates: AdditionalCoordinate[] | undefined,
  annotationVersion: number,
): Saga<boolean> {
  for (const oldId of oldIds) {
    // If one of the meshes is still in the process of being loaded, wait for this to complete.
    // Else merging incompletely loaded meshes locally would create an inconsistent state.
    const isFullyLoaded = yield* call(
      waitForMeshFullyLoaded,
      layerName,
      oldId,
      additionalCoordinates,
    );
    if (!isFullyLoaded) return false;
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

  // An ad-hoc mesh covers only the agglomerate it was computed for and carries no supervoxel
  // tagging, so a merge involving one needs a freshly loaded mesh anyway.
  const precomputedEntries = oldIdsWithMeshInfo.filter(
    (entry): entry is { oldId: bigint; meshInfo: PrecomputedMeshInformation } =>
      entry.meshInfo.isPrecomputed,
  );
  if (precomputedEntries.length !== oldIdsWithMeshInfo.length) {
    return false;
  }

  const { segmentMeshController } = yield* call(getSceneController);

  if (precomputedEntries.length === 1) {
    // Only one side has a mesh, so the other side's chunks are fetched and appended to it.
    const { oldId, meshInfo } = precomputedEntries[0];
    const isCompleted = yield* call(
      fetchAndAppendMissingPrecomputedMergeChunks,
      layerName,
      oldId,
      newId,
      meshInfo,
      additionalCoordinates,
      annotationVersion,
    );
    if (!isCompleted) {
      return false;
    }
  }

  // Move every loaded mesh into the merged id's group, set the color and then fold them into one geometry.
  for (const { oldId } of oldIdsWithMeshInfo) {
    segmentMeshController.moveMeshesToNewSegmentId(oldId, newId, layerName, additionalCoordinates);
    yield* put(mergeMeshesAction(layerName, oldId, newId, additionalCoordinates));
  }
  segmentMeshController.setMeshColor(newId, layerName);
  yield* call(mergeMeshSiblingsIntoOneGeometry, layerName, newId, additionalCoordinates);
  return true;
}

// Beyond this many missing segments, loading a new agglomerate's mesh as a whole is cheaper than
// requesting the chunks of its segments one by one.
const MAX_SEGMENTS_TO_COMPLETE_PER_AGGLOMERATE = 50;

export type LocalSplitResult = {
  handledLocally: boolean;
  // New ids the split could not give any geometry to. These need a full reload.
  idsNeedingReload: bigint[];
};

const NOT_HANDLED_LOCALLY: LocalSplitResult = { handledLocally: false, idsNeedingReload: [] };

/*
 * Asks the back-end which segments each agglomerate created by a split consists of.
 * Returns null if that information is unavailable, in which case no local split must be attempted.
 */
function* fetchSegmentIdsByNewAgglomerateId(
  layerName: string,
  newIds: bigint[],
  annotationVersion: number,
): Saga<Map<bigint, Set<bigint>> | null> {
  const tracingStoreUrl = yield* select((state) => state.annotation.tracingStore.url);
  const segmentIdsByNewId = new Map<bigint, Set<bigint>>();
  const fetchTasks = newIds.map(
    (newId) =>
      function* fetchSegmentIdsOfAgglomerate(): Saga<void> {
        try {
          const { segmentIds, agglomerateIdIsPresent } = yield* call(
            getSegmentsForAgglomerateFromTracingStore,
            tracingStoreUrl,
            layerName,
            newId,
            annotationVersion,
          );
          if (!agglomerateIdIsPresent) {
            console.warn(`Agglomerate ${newId} has no graph at version ${annotationVersion}.`);
            return;
          }
          if (segmentIds.length > 0) {
            segmentIdsByNewId.set(newId, new Set(segmentIds));
          }
        } catch (exception) {
          console.warn(`Could not fetch the segments of agglomerate ${newId}:`, exception);
        }
      },
  );
  yield* call(processTaskWithPool, fetchTasks, Constants.PARALLEL_PRECOMPUTED_MESH_LOADING_COUNT);

  // Without the segments of every new agglomerate the mesh cannot be split correctly.
  return segmentIdsByNewId.size === newIds.length ? segmentIdsByNewId : null;
}

type MissingGeometry = {
  // Segments of one new agglomerate without geometry, per LOD of the old mesh.
  segmentIdsByLod: Map<number, Set<bigint>>;
  // Their union, i.e. every segment whose chunks need to be fetched.
  allSegmentIds: Set<bigint>;
};

/*
 * Collects the segments of one new agglomerate that oldId's mesh has no geometry for. A segment can
 * have geometry for one LOD but not for another, so the gaps are collected per LOD.
 */
function collectMissingGeometry(
  segmentMeshController: SegmentMeshController,
  layerName: string,
  oldId: bigint,
  loadedLods: number[],
  segmentIds: Set<bigint>,
  additionalCoordinates: AdditionalCoordinate[] | undefined,
): MissingGeometry {
  const segmentIdsByLod = new Map<number, Set<bigint>>();
  const allSegmentIds = new Set<bigint>();
  for (const lod of loadedLods) {
    const loadedSegmentIdsOfLod = segmentMeshController.getLoadedUnmappedSegmentIds(
      oldId,
      layerName,
      lod,
      additionalCoordinates,
    );
    const missingSegmentIdsOfLod = new Set(
      [...segmentIds].filter((id) => !loadedSegmentIdsOfLod.has(id)),
    );
    segmentIdsByLod.set(lod, missingSegmentIdsOfLod);
    for (const id of missingSegmentIdsOfLod) allSegmentIds.add(id);
  }
  return { segmentIdsByLod, allSegmentIds };
}

/*
 * Fetches the chunks the given new agglomerate is missing and appends them to oldId's mesh, so that
 * the split can hand them over later on. Returns false if some chunks could not be added.
 */
function* completeGeometryOfNewId(
  layerName: string,
  oldId: bigint,
  newId: bigint,
  missingGeometry: MissingGeometry,
  meshInfo: PrecomputedMeshInformation,
  meshFile: APIMeshFileInfo,
  additionalCoordinates: AdditionalCoordinate[] | undefined,
  annotationVersion: number,
): Saga<boolean> {
  const dataset = yield* select((state) => state.dataset);
  const segmentationLayer = yield* select((state) =>
    getSegmentationLayerByName(state.dataset, layerName),
  );
  if (segmentationLayer == null) return false;

  const chunkInfo = yield* call(
    getChunksForUnmappedSegments,
    [...missingGeometry.allSegmentIds],
    dataset,
    segmentationLayer,
    meshFile,
    annotationVersion,
  );
  if (chunkInfo == null) return false;

  let isCompleted = true;
  for (const [lod, missingSegmentIdsOfLod] of missingGeometry.segmentIdsByLod) {
    if (missingSegmentIdsOfLod.size === 0) continue;
    const chunksOfLod = (chunkInfo.chunksByLod.get(lod) ?? []).filter((chunk) =>
      missingSegmentIdsOfLod.has(chunk.unmappedSegmentId),
    );
    const isAppended = yield* call(
      fetchAndAppendChunksToMesh,
      layerName,
      oldId,
      newId,
      lod,
      chunksOfLod,
      chunkInfo.chunkScale,
      meshFile,
      meshInfo.opacity,
      additionalCoordinates,
    );
    if (!isAppended) isCompleted = false;
  }
  return isCompleted;
}

/*
 * Loads the chunks of segments that belong to the mesh but have no geometry in the scene yet, so
 * that the split can hand each new agglomerate all of its geometry.
 * Returns the new agglomerate ids whose geometry could not be completed, either because loading
 * their whole mesh is cheaper or because the chunks could not be fetched. These must not be split
 * locally.
 */
function* completeMeshBeforeSplit(
  layerName: string,
  oldId: bigint,
  meshInfo: PrecomputedMeshInformation,
  segmentIdsByNewId: Map<bigint, Set<bigint>>,
  additionalCoordinates: AdditionalCoordinate[] | undefined,
  annotationVersion: number,
): Saga<Set<bigint>> {
  const incompleteNewIds = new Set<bigint>();
  const { segmentMeshController } = yield* call(getSceneController);
  const loadedLods = segmentMeshController.getLoadedLods(oldId, layerName, additionalCoordinates);
  const loadedSegmentIds = segmentMeshController.getAllLoadedUnmappedSegmentIds(
    oldId,
    layerName,
    additionalCoordinates,
  );

  const missingGeometryByNewId = new Map<bigint, MissingGeometry>();
  for (const [newId, segmentIds] of segmentIdsByNewId) {
    const missingGeometry = collectMissingGeometry(
      segmentMeshController,
      layerName,
      oldId,
      loadedLods,
      segmentIds,
      additionalCoordinates,
    );
    if (missingGeometry.allSegmentIds.size === 0) continue;

    const hasAnyGeometry = [...segmentIds].some((id) => loadedSegmentIds.has(id));
    if (
      !hasAnyGeometry ||
      missingGeometry.allSegmentIds.size > MAX_SEGMENTS_TO_COMPLETE_PER_AGGLOMERATE
    ) {
      // Loading this agglomerate's mesh as a whole is cheaper than completing it segment by segment.
      incompleteNewIds.add(newId);
      continue;
    }
    missingGeometryByNewId.set(newId, missingGeometry);
  }
  if (missingGeometryByNewId.size === 0) return incompleteNewIds;

  const meshFile = yield* call(getMeshFileOfLoadedMesh, layerName, meshInfo);
  if (meshFile == null) {
    return new Set([...incompleteNewIds, ...missingGeometryByNewId.keys()]);
  }

  for (const [newId, missingGeometry] of missingGeometryByNewId) {
    const isCompleted = yield* call(
      completeGeometryOfNewId,
      layerName,
      oldId,
      newId,
      missingGeometry,
      meshInfo,
      meshFile,
      additionalCoordinates,
      annotationVersion,
    );
    if (!isCompleted) incompleteNewIds.add(newId);
  }
  return incompleteNewIds;
}

/*
 * Tries to split a local mesh by separating it into sub geometries based on the segments the
 * back-end reports for each new agglomerate. The split off meshes get assigned to their own scene
 * graph mesh group and the old one is kept with its designated sub geometry only if the split left
 * over some parts of the mesh for the old agglomerate id.
 * handledLocally is false if the whole split needs a full reload of the meshes. Otherwise
 * idsNeedingReload lists the new ids that got no geometry and thus still need to be loaded.
 */
export function* trySplitMeshLocally(
  layerName: string,
  oldId: bigint,
  newIds: bigint[],
  additionalCoordinates: AdditionalCoordinate[] | undefined,
  annotationVersion: number,
): Saga<LocalSplitResult> {
  const isFullyLoaded = yield* call(
    waitForMeshFullyLoaded,
    layerName,
    oldId,
    additionalCoordinates,
  );
  if (!isFullyLoaded) return NOT_HANDLED_LOCALLY;

  const meshInfo = yield* select((state) =>
    getMeshInfoForSegment(state, additionalCoordinates ?? null, layerName, oldId),
  );
  if (meshInfo == null || !meshInfo.isPrecomputed) {
    // No mesh loaded, or an ad-hoc mesh (no supervoxel tagging): can't split locally.
    return NOT_HANDLED_LOCALLY;
  }

  const { segmentMeshController } = yield* call(getSceneController);
  if (!segmentMeshController.hasFullyMergedMesh(oldId, layerName, additionalCoordinates)) {
    return NOT_HANDLED_LOCALLY;
  }

  const segmentIdsByNewId = yield* call(
    fetchSegmentIdsByNewAgglomerateId,
    layerName,
    newIds,
    annotationVersion,
  );
  if (segmentIdsByNewId == null) return NOT_HANDLED_LOCALLY;

  const incompleteNewIds = yield* call(
    completeMeshBeforeSplit,
    layerName,
    oldId,
    meshInfo,
    segmentIdsByNewId,
    additionalCoordinates,
    annotationVersion,
  );

  // A new id without complete geometry would get a store entry but nothing (or too little) in the
  // scene, and the reload fallback would then skip it as already loaded. So it is left out of the
  // split and reloaded.
  const idsNeedingReloadSet = new Set([
    ...segmentMeshController.getNewAgglomerateIdsWithoutGeometry(
      oldId,
      layerName,
      segmentIdsByNewId,
      additionalCoordinates,
    ),
    ...incompleteNewIds,
  ]);
  const idsNeedingReload = [...idsNeedingReloadSet];
  const idsToSplit = newIds.filter((newId) => !idsNeedingReloadSet.has(newId));
  if (idsToSplit.length === 0) return NOT_HANDLED_LOCALLY;

  const segmentIdsByIdToSplit = new Map(
    [...segmentIdsByNewId].filter(([newId]) => !idsNeedingReloadSet.has(newId)),
  );

  // Update Redux (and thus the new ids' isVisible, which addMeshFromGeometry reads when creating
  // their target groups) before touching the scene graph.
  yield* put(splitMeshAction(layerName, oldId, idsToSplit, additionalCoordinates));

  const succeeded = yield* call(
    { context: segmentMeshController, fn: segmentMeshController.splitMeshByNewMapping },
    oldId,
    layerName,
    segmentIdsByIdToSplit,
    meshInfo.opacity,
    additionalCoordinates,
  );
  if (!succeeded) {
    // Shouldn't happen given the checks above. The store entries splitMeshAction created must be
    // dropped again, else the caller's reload fallback would skip all new ids as already loaded.
    console.error(`splitMeshByNewMapping unexpectedly failed for segment ${oldId}.`);
    for (const newId of new Set([oldId, ...idsToSplit])) {
      yield* put(removeMeshAction(layerName, newId));
    }
    return NOT_HANDLED_LOCALLY;
  }

  for (const newId of idsToSplit) {
    segmentMeshController.setMeshColor(newId, layerName);
  }
  return { handledLocally: true, idsNeedingReload };
}

// Exported so the parked, currently-unused pooled/dependency-aware scheduler in
// parked_pooled_local_mesh_change_scheduler.ts can reuse this type without duplicating it - see
// that file for context on why it isn't wired in here.
// TODO discuss whether we want to keep this version or switch to the dependency-aware scheduler.
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

/*
 * Detects merge- and split-shaped groups within one batch of change items.
 * Merge shape: two or more old ids collapse into the same new id.
 * Split shape: one old id fans out into two or more new ids, e.g. a "split from all neighbours".
 * Items fitting neither shape are returned as remainingItems.
 *
 * One batch can contain both shapes at once, e.g. a local split whose items incorporate an
 * interfering foreign merge, so both are always detected together.
 *
 * Known limitation: an item of a merge group is never reconsidered for a split group, even if that
 * merge later fails to apply locally. Such a batch falls back to a plain reload.
 */
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
