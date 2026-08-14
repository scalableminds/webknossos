import { NumberLikeMapWrapper } from "libs/number_like_map_wrapper";
import Toast from "libs/toast";
import messages from "messages";
import { call, put } from "typed-redux-saga";
import {
  resetMultiCutToolPartitionsAction,
  setMultiCutAgglomerateIdAction,
} from "viewer/model/actions/proofread_actions";
import { setMappingDataAction } from "viewer/model/actions/settings_actions";
import type { Saga } from "viewer/model/sagas/effect_generators";
import { select } from "viewer/model/sagas/effect_generators";
import type { ActiveMappingInfo, Mapping, MinCutPartitions } from "viewer/store";
import { splitAgglomeratesInMapping } from "./local_mapping_update_sagas";

// Shared by both resolvers below (one derives agglomerate ids from loaded mesh data, the other
// from a local mapping):
// - "single": every selected supervoxel that could be resolved belongs to one agglomerate (its id).
// - "scattered": the resolved supervoxels span multiple agglomerates (invalid for a min-cut split).
// - "unresolved": none of the selected supervoxels could be resolved (e.g. mesh not loaded yet).
type MultiCutSelectionResolution =
  | { type: "single"; agglomerateId: number }
  | { type: "scattered" }
  | { type: "unresolved" };

// Returns the selected supervoxel ids that have no entry in the given mapping yet.
function findUnresolvedSupervoxelIds(
  mapping: Mapping,
  minCutPartitions: MinCutPartitions,
): number[] {
  const mappingWrapper = new NumberLikeMapWrapper(mapping);
  return [...minCutPartitions.partitionA, ...minCutPartitions.partitionB].filter(
    (segmentId) => mappingWrapper.getAsNumber(segmentId) == null,
  );
}

// Just check for the given mapping whether the minCutPartitions are
// still part of one single agglomerate.
function resolveMultiCutSelectionFromMapping(
  mapping: Mapping,
  minCutPartitions: MinCutPartitions,
): MultiCutSelectionResolution {
  const mappingWrapper = new NumberLikeMapWrapper(mapping);
  const agglomerateIds = new Set<number>();
  for (const segmentId of [...minCutPartitions.partitionA, ...minCutPartitions.partitionB]) {
    const agglomerateId = mappingWrapper.getAsNumber(segmentId);
    if (agglomerateId != null) {
      agglomerateIds.add(agglomerateId);
    }
  }

  if (agglomerateIds.size > 1) {
    return { type: "scattered" };
  }
  if (agglomerateIds.size === 1) {
    return { type: "single", agglomerateId: [...agglomerateIds][0] };
  }
  return { type: "unresolved" };
}

// Fetches the current agglomerate ids of segments that a foreign split left unresolved in the
// local mapping (tagging each with the pre-split agglomerate id the selection was tracking), and
// returns the resulting mapping with those ids added. Returns undefined if the fetch failed.
function* fetchMissingSupervoxelAgglomerateIds(
  tracingId: string,
  activeMapping: ActiveMappingInfo,
  missingSegmentIds: number[],
  oldAgglomerateId: number,
  version: number,
): Saga<Mapping | undefined> {
  const segmentIdToOldAgglomerateId = new Map(
    missingSegmentIds.map((segmentId) => [segmentId, oldAgglomerateId] as [number, number]),
  );
  const splitInfo = yield* call(
    splitAgglomeratesInMapping,
    activeMapping,
    segmentIdToOldAgglomerateId,
    tracingId,
    version,
    false, // No need to re-sync agglomerate skeleton trees for this lookup-only fetch.
    // addAdditionalSegmentsToMapping: we explicitly want segmentIdToOldAgglomerateId to
    // be present in the returned mapping.
    true,
  );
  return splitInfo?.mappingWithSplitApplied;
}

//Reconciles the multi-cut selection as a side effect of incorporating a foreign
// mergeAgglomerate update action. A merge can only change the agglomerate id of the
// multi-cut selection and never invalidate it. This function just updates the agglomerate
// id of the multi cut info in the store if it was changed due to the foreign merge action.
export function* reconcileMultiCutSelectionAfterForeignMerge(
  tracingId: string,
  agglomerateId1: number,
  agglomerateId2: number,
): Saga<void> {
  const minCutPartitions = yield* select(
    (state) => state.localSegmentationStateByLayer[tracingId]?.minCutPartitions,
  );
  if (minCutPartitions?.agglomerateId == null) {
    return;
  }
  // agglomerateId2 is merged into agglomerateId1 (see mergeAgglomerate handling in
  // incorporate_update_actions_sagas.ts).
  if (minCutPartitions.agglomerateId === agglomerateId2) {
    yield* put(setMultiCutAgglomerateIdAction(agglomerateId1));
  }
}

// Reconciles the multi-split selection as a side effect of incorporating a foreign
// splitAgglomerate update action batch. Unlike merges, a split can
// invalidate the selection, so we need to know the post-split agglomerate id of every selected
// supervoxel before deciding. Any supervoxel not yet known in the local mapping is explicitly
// fetched from the backend and then the multi-split  info is updated or even cleared when the
// split separated some of the currently selected segments for multi-split.
export function* reconcileMultiCutSelectionAfterForeignSplit(
  tracingId: string,
  oldAgglomerateIds: ReadonlySet<number>,
  activeMapping: ActiveMappingInfo,
  mappingWithSplitApplied: Mapping,
  version: number,
): Saga<void> {
  const minCutPartitions = yield* select(
    (state) => state.localSegmentationStateByLayer[tracingId]?.minCutPartitions,
  );
  const hasNoActiveMultiMincut =
    minCutPartitions?.agglomerateId == null ||
    minCutPartitions.partitionA.length + minCutPartitions.partitionB.length === 0;
  if (hasNoActiveMultiMincut || !oldAgglomerateIds.has(minCutPartitions?.agglomerateId)) {
    return;
  }
  if (!oldAgglomerateIds.has(minCutPartitions?.agglomerateId)) {
    return;
  }

  let mapping = mappingWithSplitApplied;
  const missingSegmentIds = findUnresolvedSupervoxelIds(mapping, minCutPartitions);
  if (missingSegmentIds.length > 0) {
    const fetchedMapping = yield* call(
      fetchMissingSupervoxelAgglomerateIds,
      tracingId,
      activeMapping,
      missingSegmentIds,
      minCutPartitions.agglomerateId,
      version,
    );
    if (fetchedMapping == null) {
      console.warn(
        "Could not fetch agglomerate ids for multi-cut selection segments to reconcile after a foreign split.",
        missingSegmentIds,
      );
      return;
    }
    mapping = fetchedMapping;
    // Persist into the local mapping as a separate dispatch, so the primary split's own
    // setMappingDataAction call (and the tests asserting on its exact shape) stay untouched.
    yield* put(setMappingDataAction(tracingId, mapping, false));
  }

  const resolution = resolveMultiCutSelectionFromMapping(mapping, minCutPartitions);
  if (resolution.type === "scattered") {
    // The foreign split scattered the selection across multiple agglomerates. A min-cut can only
    // split a single agglomerate, so the selection is no longer valid. Clear it and inform the user.
    yield* put(resetMultiCutToolPartitionsAction());
    Toast.warning(messages["proofreading.multi_cut.selection_invalidated_by_other_user"]);
  } else if (
    resolution.type === "single" &&
    resolution.agglomerateId !== minCutPartitions.agglomerateId
  ) {
    // The selection stayed within one agglomerate, but under a new id. Keep the selection's
    // agglomerate id in sync so further supervoxel toggles are not rejected.
    yield* put(setMultiCutAgglomerateIdAction(resolution.agglomerateId));
  }
  // resolution.type === "unresolved" here means the backend didn't return an agglomerate id for
  // one of the segments even after the explicit fetch (e.g. it no longer exists). Left as-is;
  // performPartitionedMinCut's pre-commit check remains the final safety net for this edge case.
}
