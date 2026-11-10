import {
  getAgglomeratesForSegmentsFromDatastore,
  getAgglomeratesForSegmentsFromTracingstore,
} from "admin/rest_api";
import { NumberLikeMapWrapper } from "libs/number_like_map_wrapper";
import type { APIDataLayer, APIDataset } from "types/api_types";
import { MappingStatusEnum } from "viewer/constants";
import { getLayerByName, getMappingInfo } from "viewer/model/accessors/dataset_accessor";
import {
  getBucketRetrievalSourceFn,
  getEditableMappingForVolumeTracingId,
} from "viewer/model/accessors/volumetracing_accessor";
import type {
  EditableMapping,
  Mapping,
  NumberLike,
  StoreAnnotation,
  WebknossosState,
} from "viewer/store";
import Store from "viewer/store";

export type MappedIdResult =
  // The id is mapped to `value`. If no mapping is applied locally (no mapping active or
  // the mapping is applied by the server), the bucket data already contains the final id
  // and it is returned as is.
  | { type: "exists"; value: bigint }
  // The local mapping doesn't know the id (yet). For HDF5 mappings, this happens because
  // only the entries for the currently needed buckets are loaded. It also happens while
  // a mapping is still being activated.
  | { type: "unknown" }
  // The mapping is a fully loaded JSON mapping without an entry for the id. This is not an
  // error: JSON mappings don't need to contain all ids.
  | { type: "absent" };

// If this is false, the bucket data already contains the final ids, because either no
// mapping is active or the mapping is applied by the server.
export function isMappingAppliedLocally(state: WebknossosState, layerName: string): boolean {
  return getBucketRetrievalSourceFn(layerName)(state)[1] === "LOCAL-MAPPING-APPLIED";
}

export function getMappedId(
  state: WebknossosState,
  layerName: string,
  unmappedId: bigint,
): MappedIdResult {
  // Background is never mapped to another id. The local HDF5 mapping doesn't necessarily
  // contain an entry for it.
  if (unmappedId === 0n || !isMappingAppliedLocally(state, layerName)) {
    return { type: "exists", value: unmappedId };
  }

  const { mapping, mappingStatus, mappingType } = getMappingInfo(
    state.temporaryConfiguration.activeMappingByLayer,
    layerName,
  );
  if (mapping == null || mappingStatus !== MappingStatusEnum.ENABLED) {
    return { type: "unknown" };
  }
  const mappedId = new NumberLikeMapWrapper(mapping).getAsBigInt(unmappedId);
  if (mappedId != null) {
    return { type: "exists", value: mappedId };
  }
  return mappingType === "JSON" ? { type: "absent" } : { type: "unknown" };
}

// Like getMappedId, but fetches the mapped id from the server if the local HDF5 mapping
// doesn't know it. The fetched entry is not added to the local mapping, because the next
// update of the local mapping would remove it anyway if it's not needed for rendering.
// "unknown" is only returned for a JSON mapping that is still being activated or if the
// server didn't return an entry for the id.
export async function getMappedIdAsync(
  layerName: string,
  unmappedId: bigint,
): Promise<MappedIdResult> {
  const state = Store.getState();
  const result = getMappedId(state, layerName, unmappedId);
  const { mappingName, mappingType } = getMappingInfo(
    state.temporaryConfiguration.activeMappingByLayer,
    layerName,
  );
  if (result.type !== "unknown" || mappingType === "JSON" || mappingName == null) {
    return result;
  }

  const fetchedEntries = await fetchAgglomeratesForSegmentIds(
    state.dataset,
    state.annotation,
    getEditableMappingForVolumeTracingId(state, layerName),
    layerName,
    getLayerByName(state.dataset, layerName),
    mappingName,
    new Set([unmappedId]),
  );
  // Discard the result if another mapping was activated while the request was pending.
  const currentMappingInfo = getMappingInfo(
    Store.getState().temporaryConfiguration.activeMappingByLayer,
    layerName,
  );
  if (
    currentMappingInfo.mappingName !== mappingName ||
    currentMappingInfo.mappingStatus !== MappingStatusEnum.ENABLED
  ) {
    return { type: "unknown" };
  }
  const mappedId = new NumberLikeMapWrapper(fetchedEntries).getAsBigInt(unmappedId);
  return mappedId != null ? { type: "exists", value: mappedId } : { type: "unknown" };
}

// Returns the id that the segment with the given unmapped id has under the current mapping
// or null if that's not known (yet). For ids that are absent in a JSON mapping, this is the
// unmapped id (or 0 if unmapped ids are hidden).
export function resolveUnmappedSegmentId(
  state: WebknossosState,
  layerName: string,
  unmappedId: bigint,
): bigint | null {
  return getSegmentIdFromResult(
    state,
    layerName,
    unmappedId,
    getMappedId(state, layerName, unmappedId),
  );
}

// Like resolveUnmappedSegmentId, but fetches the mapped id from the server if the local
// HDF5 mapping doesn't know it (see getMappedIdAsync).
export async function resolveUnmappedSegmentIdAsync(
  layerName: string,
  unmappedId: bigint,
): Promise<bigint | null> {
  const result = await getMappedIdAsync(layerName, unmappedId);
  return getSegmentIdFromResult(Store.getState(), layerName, unmappedId, result);
}

function getSegmentIdFromResult(
  state: WebknossosState,
  layerName: string,
  unmappedId: bigint,
  result: MappedIdResult,
): bigint | null {
  switch (result.type) {
    case "exists":
      return result.value;
    case "unknown":
      return null;
    case "absent": {
      const { hideUnmappedIds } = getMappingInfo(
        state.temporaryConfiguration.activeMappingByLayer,
        layerName,
      );
      return hideUnmappedIds ? 0n : unmappedId;
    }
  }
}

export async function fetchAgglomeratesForSegmentIds(
  dataset: APIDataset,
  annotation: StoreAnnotation,
  editableMapping: EditableMapping | null | undefined,
  layerName: string,
  layerInfo: APIDataLayer,
  mappingName: string,
  newSegmentIds: Set<NumberLike>,
): Promise<Mapping> {
  // If there is a fallbackLayer, request mappings for that instead of the tracing segmentation layer
  const mappingLayerName =
    "fallbackLayer" in layerInfo && layerInfo.fallbackLayer != null
      ? layerInfo.fallbackLayer
      : layerName;

  return editableMapping != null
    ? getAgglomeratesForSegmentsFromTracingstore(
        annotation.tracingStore.url,
        editableMapping.tracingId,
        newSegmentIds,
        annotation.annotationId,
        annotation.version,
      )
    : getAgglomeratesForSegmentsFromDatastore(
        dataset.dataStore.url,
        dataset,
        mappingLayerName,
        mappingName,
        newSegmentIds,
      );
}
