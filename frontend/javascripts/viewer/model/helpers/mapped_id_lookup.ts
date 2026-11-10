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

// If this is false, the bucket data already contains the final ids, because either no
// mapping is active or the mapping is applied by the server.
export function isMappingAppliedLocally(state: WebknossosState, layerName: string): boolean {
  return getBucketRetrievalSourceFn(layerName)(state)[1] === "LOCAL-MAPPING-APPLIED";
}

// Returns the id that the given unmapped id has under the current mapping of the layer, or
// null if the local mapping doesn't know it (yet). For HDF5 mappings, the latter happens
// because only the entries for the currently needed buckets are loaded. It also happens while
// a mapping is still being activated.
// If no mapping is applied locally (no mapping active or the mapping is applied by the
// server), the bucket data already contains the final id and it is returned as is. The same
// holds for background (0).
// A JSON mapping doesn't need to contain all ids. An id without an entry is not an error: it
// keeps its unmapped id (or becomes 0 if unmapped ids are hidden), as in the rendering.
export function getMappedId(
  state: WebknossosState,
  layerName: string,
  unmappedId: bigint,
): bigint | null {
  if (unmappedId === 0n || !isMappingAppliedLocally(state, layerName)) {
    return unmappedId;
  }

  const { mapping, mappingStatus, mappingType, hideUnmappedIds } = getMappingInfo(
    state.temporaryConfiguration.activeMappingByLayer,
    layerName,
  );
  if (mapping == null || mappingStatus !== MappingStatusEnum.ENABLED) {
    return null;
  }
  const mappedId = new NumberLikeMapWrapper(mapping).getAsBigInt(unmappedId);
  if (mappedId != null) {
    return mappedId;
  }
  if (mappingType === "JSON") {
    return hideUnmappedIds ? 0n : unmappedId;
  }
  return null;
}

// Like getMappedId, but fetches the mapped id from the server if the local HDF5 mapping
// doesn't know it. The fetched entry is not added to the local mapping, because the next
// update of the local mapping would remove it anyway if it's not needed for rendering.
// Null is only returned for a JSON mapping that is still being activated, if the server didn't
// return an entry for the id or if the mapping changed while the request was pending.
export async function getMappedIdAsync(
  layerName: string,
  unmappedId: bigint,
): Promise<bigint | null> {
  const state = Store.getState();
  const mappedId = getMappedId(state, layerName, unmappedId);
  const { mappingName, mappingType } = getMappingInfo(
    state.temporaryConfiguration.activeMappingByLayer,
    layerName,
  );
  if (mappedId != null || mappingType === "JSON" || mappingName == null) {
    return mappedId;
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
    return null;
  }
  return new NumberLikeMapWrapper(fetchedEntries).getAsBigInt(unmappedId) ?? null;
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
