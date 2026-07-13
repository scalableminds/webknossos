import { getAgglomeratesForSegmentsFromTracingstore } from "admin/rest_api";
import { getAdaptToTypeFunction, isNumberMap } from "libs/utils";
import { call, put } from "typed-redux-saga";
import { setMappingDataAction } from "viewer/model/actions/settings_actions";
import type { Saga } from "viewer/model/sagas/effect_generators";
import { select } from "viewer/model/sagas/effect_generators";
import type { ActiveMappingInfo, Mapping, NumberLikeMap } from "viewer/store";
import { syncAgglomerateTreesAfterSplitAction } from "./agglomerate_tree_syncing_saga_helpers";
import { getMappedIdAsBigInt } from "./preparation_sagas";

function getSegmentIdsThatMapToAgglomerate(
  activeMapping: ActiveMappingInfo,
  sourceAgglomerateId: bigint,
): bigint[] {
  // Obtain all segment ids that map to sourceAgglomerateId
  const mappingEntries = Array.from(activeMapping.mapping as NumberLikeMap);

  // If the mapping contains numbers (uint32-backed dataset) rather than BigInts, we need a
  // plain number for the filtering. This is safe because such mappings never contain ids
  // that exceed the safe integer range.
  const comparableSourceAgglomerateId =
    activeMapping.mapping != null
      ? getMappedIdAsBigInt(activeMapping.mapping, sourceAgglomerateId)
      : sourceAgglomerateId;
  return mappingEntries
    .filter(([_segmentId, agglomerateId]) => agglomerateId === comparableSourceAgglomerateId)
    .map(([segmentId, _agglomerateId]) => BigInt(segmentId));
}

type SplitAgglomeratesInMappingResult = {
  mappingWithSplitApplied: Mapping;
  oldAgglomerateIds: Set<bigint>;
  newAgglomerateIds: Set<bigint>;
  newToOldAgglomerateIds: Map<bigint, bigint>;
};

/**
 * Re-builds the local mapping to reflect one or more server-side agglomerate splits by re-requesting the
 * affected segments' new agglomerate ids and returning the updated mapping plus the involved old/new ids.
 *
 * Affected segment IDs are found by scanning the local mapping for ids that map to the provided agglomerate
 * IDs. Additionally, all keys of the `segmentIdToOldAgglomerateId` parameter are also considered to be
 * "affected". `segmentIdToOldAgglomerateId` doesn't need to contain *all* segment ids that map to a common
 * agglomerate ID. Instead, a segment ID only needs to be contained if the caller needs the ID to be part of
 * the returned mapping (`addAdditionalSegmentsToMapping` needs to be set to true, too).
 *
 * This is the general (plural) implementation which can split several agglomerates at once. For the common
 * case of splitting a single agglomerate, prefer the {@link splitAgglomerateInMapping} wrapper.
 *
 * @param activeMapping - Current mapping info which is copied and mutated to reflect the reassigned segments
 *   before returning the new mapping as mappingWithSplitApplied.
 * @param segmentIdToOldAgglomerateId - (Some¹) segment IDs involved in the split action, mapped to its pre-split
 *   agglomerate id. Must contain at least one segment of the split agglomerate. Segments may be passed even if
 *   they are not in the local mapping (e.g. while forwarded foreign splits during rebasing).
 *   ¹ See paragraph about "affected segment ids" above for more details about the impact of passed IDs.
 * @param volumeTracingId - Id of the volume tracing whose (editable) mapping is updated.
 * @param version - Annotation version at which to look up the post-split agglomerate ids.
 * @param syncAgglomerateTrees - If true, sync the skeleton trees to the split.
 * @param addAdditionalSegmentsToMapping - Whether to also write the passed segments into the returned
 *   mapping which are currently not part of the activeMapping.
 *  (needed e.g. by partitioned min-cut; forwarded foreign splits keep them out).
 * @returns `undefined` if nothing to split and the input mapping is `null`; otherwise `{ mappingWithSplitApplied`
 *   (rebuilt full mapping)`, oldAgglomerateIds` (ids before the split)`, newAgglomerateIds` (new ids produced
 *   by the split)`, newToOldAgglomerateIds` (each new id → the old id it came from, e.g. for carrying over
 *   mesh opacity)`}`.
 */
export function* splitAgglomeratesInMapping(
  activeMapping: ActiveMappingInfo,
  segmentIdToOldAgglomerateId: Map<bigint, bigint>,
  volumeTracingId: string,
  version: number,
  syncAgglomerateTrees: boolean,
  addAdditionalSegmentsToMapping = false,
): Saga<SplitAgglomeratesInMappingResult | undefined> {
  // The old agglomerate ids are all agglomerates the passed segments belonged to before the split.
  const oldAgglomerateIds = new Set<bigint>(segmentIdToOldAgglomerateId.values());
  // Re-map the local segments of EVERY involved old agglomerate, so that segments of those
  // agglomerates are not left in an outdated state.
  const localSegmentIds = new Set(
    Array.from(oldAgglomerateIds).flatMap((oldAgglomerateId) =>
      getSegmentIdsThatMapToAgglomerate(activeMapping, oldAgglomerateId),
    ),
  );
  const splitSegmentIds = localSegmentIds.union(new Set(segmentIdToOldAgglomerateId.keys()));
  const annotationId = yield* select((state) => state.annotation.annotationId);
  const tracingStoreUrl = yield* select((state) => state.annotation.tracingStore.url);
  // Ask the server to map the (split) segment ids. This creates a partial mapping
  // that only contains these ids.
  const mappingBeforeSplit = activeMapping.mapping;
  if (splitSegmentIds.size === 0 || mappingBeforeSplit == null) {
    return mappingBeforeSplit != null
      ? {
          mappingWithSplitApplied: mappingBeforeSplit,
          newAgglomerateIds: new Set(),
          oldAgglomerateIds: new Set(),
          newToOldAgglomerateIds: new Map(),
        }
      : undefined;
  }
  const requestedMappingInfo = yield* call(
    getAgglomeratesForSegmentsFromTracingstore,
    tracingStoreUrl,
    volumeTracingId,
    splitSegmentIds,
    annotationId,
    version,
  );
  const newToOldAgglomerateIds = new Map<bigint, bigint>();

  const knownAndAdditionalSegmentIds = new Set<bigint>(
    Array.from((mappingBeforeSplit as NumberLikeMap).keys(), (segmentId) => BigInt(segmentId)),
  ).union(new Set(segmentIdToOldAgglomerateId.keys()));

  // The mapping's native key/value type (number for uint32-backed datasets, bigint for uint64) must
  // be preserved when re-building it, so ids are adapted back to that type before being written.
  const adaptToType = getAdaptToTypeFunction(mappingBeforeSplit);

  // Create a new mapping which is equal to the old one with the difference that
  // ids requested from the backend are mapped to their new target agglomerate ids.
  // If addAdditionalSegmentsToMapping = true all requested segment ids are included
  // in the mapping. Even those not present before but requested. In parallel the
  // newToOldAgglomerateIds map is built and then used on the caller site to maintain
  // mesh opacity and visibility between reloading the meshes.
  const mappingWithSplitApplied = new Map();
  knownAndAdditionalSegmentIds.forEach((segmentId) => {
    const mappedId = getMappedIdAsBigInt(requestedMappingInfo, segmentId);
    const previousMappedId = getMappedIdAsBigInt(mappingBeforeSplit, segmentId);
    if (mappedId != null) {
      const prevAgglomerateId = segmentIdToOldAgglomerateId.get(segmentId) ?? previousMappedId;
      if (prevAgglomerateId != null) {
        // A split never merges two old agglomerates into one new one, so every segment that maps to
        // a given newId shares the same prevAgglomerateId — overwriting an existing entry is a no-op.
        newToOldAgglomerateIds.set(mappedId, prevAgglomerateId);
      }
      if (previousMappedId != null || addAdditionalSegmentsToMapping) {
        mappingWithSplitApplied.set(adaptToType(segmentId), adaptToType(mappedId));
      }
    } else {
      if (splitSegmentIds.has(segmentId)) {
        console.error(
          "Got a agglomerate id mapping reply from the server which did not include the new agglomerate id of a requested segment.",
          `${segmentId} was not present in ${requestedMappingInfo.entries()}.`,
        );
      }
      // The segment was not requested / not included in the reply, but already present in the previous mapping. Just copy it over.
      if (previousMappedId != null) {
        mappingWithSplitApplied.set(adaptToType(segmentId), adaptToType(previousMappedId));
      }
    }
  });

  const newAgglomerateIds = new Set(newToOldAgglomerateIds.keys());
  if (syncAgglomerateTrees && activeMapping.mappingName) {
    yield* call(
      syncAgglomerateTreesAfterSplitAction,
      Array.from(newAgglomerateIds),
      Array.from(oldAgglomerateIds),
      volumeTracingId,
    );
  }

  return {
    mappingWithSplitApplied: mappingWithSplitApplied as Mapping,
    oldAgglomerateIds,
    newAgglomerateIds,
    newToOldAgglomerateIds,
  };
}

/**
 * Lightweight wrapper around {@link splitAgglomeratesInMapping} for the common case of splitting a
 * single agglomerate. It tags every affected segment with the same `agglomerateId` and delegates to
 * the plural implementation.
 *
 * @param agglomerateId - The agglomerate id that was split.
 * @param affectedSegmentIds - Segment ids known to have belonged to `agglomerateId` before the split.
 *   At least one must be provided so the split can be resolved even when the agglomerate has no
 *   segments in the local mapping. Segments that are not part of the local mapping are only written
 *   into the returned mapping when `addAdditionalSegmentsToMapping` is set.
 *   The parameter doesn't need to contain *all* segment ids that map to a common agglomerate ID
 *  (see referenced function above for more information).
 *
 * @see splitAgglomeratesInMapping for the remaining parameters and the return value.
 */
export function* splitAgglomerateInMapping(
  activeMapping: ActiveMappingInfo,
  agglomerateId: bigint,
  affectedSegmentIds: Iterable<bigint>,
  volumeTracingId: string,
  version: number,
  syncAgglomerateTrees: boolean,
  addAdditionalSegmentsToMapping = false,
): Saga<SplitAgglomeratesInMappingResult | undefined> {
  const segmentIdToOldAgglomerateId = new Map(
    Array.from(affectedSegmentIds, (segmentId) => [segmentId, agglomerateId] as [bigint, bigint]),
  );
  return yield* splitAgglomeratesInMapping(
    activeMapping,
    segmentIdToOldAgglomerateId,
    volumeTracingId,
    version,
    syncAgglomerateTrees,
    addAdditionalSegmentsToMapping,
  );
}

function* mergeAgglomeratesInMapping(
  activeMapping: ActiveMappingInfo,
  sourceAgglomerateId: bigint,
  targetAgglomerateId: bigint,
): Saga<Mapping> {
  // The mapping is either number- or BigInt-keyed/valued (uint32- vs. uint64-backed dataset).
  // Number-keyed mappings never contain ids exceeding the safe integer range, so the
  // round-trip through Number() below is safe.
  const isNumberBackedMapping = activeMapping.mapping != null && isNumberMap(activeMapping.mapping);
  const typedTargetAgglomerateId = isNumberBackedMapping
    ? Number(targetAgglomerateId)
    : targetAgglomerateId;
  const typedSourceAgglomerateId = isNumberBackedMapping
    ? Number(sourceAgglomerateId)
    : sourceAgglomerateId;
  return new Map(
    Array.from(activeMapping.mapping as NumberLikeMap, ([key, value]) =>
      value === typedTargetAgglomerateId ? [key, typedSourceAgglomerateId] : [key, value],
    ),
  ) as Mapping;
}

export function* updateMappingWithMerge(
  volumeTracingId: string,
  activeMapping: ActiveMappingInfo,
  sourceAgglomerateId: bigint,
  targetAgglomerateId: bigint,
  // Must be true if we know that the updated mapping info was already saved on the server.
  isVersionStoredOnServer: boolean,
) {
  const mergedMapping = yield* call(
    mergeAgglomeratesInMapping,
    activeMapping,
    sourceAgglomerateId,
    targetAgglomerateId,
  );
  // Even when the merge was a no-op, we still dispatch setMappingDataAction here, so the activation completes correctly (see the finishMappingActivation saga).
  yield* put(setMappingDataAction(volumeTracingId, mergedMapping, isVersionStoredOnServer));
}
