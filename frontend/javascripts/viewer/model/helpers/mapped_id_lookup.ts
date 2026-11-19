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
  isZoomThresholdExceededForAgglomerateMapping,
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
export function mapId(
  state: WebknossosState,
  layerName: string,
  unmappedId: bigint,
): bigint | null {
  if (unmappedId === 0n || !isMappingAppliedLocally(state, layerName)) {
    return unmappedId;
  }

  const { mapping, mappingType, hideUnmappedIds } = getMappingInfo(
    state.temporaryConfiguration.activeMappingByLayer,
    layerName,
  );
  // The mapping status is not checked: each update of the mapping data (e.g., when HDF5 entries
  // are loaded or after a split) sets it to ACTIVATING until the textures are updated, but the
  // data in the store is already valid. While a mapping is being activated, the data is null.
  if (mapping == null) {
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

// Like mapId, but fetches the mapped id from the server if the local HDF5 mapping
// doesn't know it. The fetched entry is not added to the local mapping, because the next
// update of the local mapping would remove it anyway if it's not needed for rendering.
// Null is only returned for a JSON mapping that is still being activated, if the request failed,
// if the server didn't return an entry for the id or if the mapping changed while the request
// was pending.
export async function mapIdAsync(layerName: string, unmappedId: bigint): Promise<bigint | null> {
  const state = Store.getState();
  const mappedId = mapId(state, layerName, unmappedId);
  const { mappingName, mappingType } = getMappingInfo(
    state.temporaryConfiguration.activeMappingByLayer,
    layerName,
  );
  if (mappedId != null || mappingType === "JSON" || mappingName == null) {
    return mappedId;
  }

  let fetchedId: bigint | null;
  try {
    fetchedId = await fetchMappedId(state, layerName, mappingName, unmappedId);
  } catch (exception) {
    // The callers handle null (e.g., with a toast), so a failed request doesn't crash the sagas.
    console.error(`Could not fetch the mapped id for ${unmappedId}:`, exception);
    return null;
  }
  // Discard the result if the mapping was switched or disabled while the request was pending.
  const currentMappingInfo = getMappingInfo(
    Store.getState().temporaryConfiguration.activeMappingByLayer,
    layerName,
  );
  if (
    currentMappingInfo.mappingName !== mappingName ||
    currentMappingInfo.mappingStatus === MappingStatusEnum.DISABLED
  ) {
    return null;
  }
  return fetchedId;
}

const MAPPING_DATA_TIMEOUT_MS = 60_000;

// Returns the id as which the given id (as contained in the bucket data) is rendered once the
// data that is needed for rendering is available:
// - If no mapping is applied locally, the bucket data already contains the rendered id.
// - If the zoom limit for agglomerate mappings is exceeded, the local mapping isn't applied
//   during rendering.
// - While a JSON mapping is being activated, this waits until its data is available.
// - If the local HDF5 mapping doesn't know the id (yet), the mapped id is fetched from the
//   server (0 if the server has no entry for it).
// Throws if the mapped id can't be fetched. Returns null if the mapping of the layer changed
// in the meantime. The id needs to be read again then, because the bucket data might change, too.
export async function mapIdAsRendered(layerName: string, id: bigint): Promise<bigint | null> {
  const state = Store.getState();
  const bucketRetrievalSource = getBucketRetrievalSourceFn(layerName)(state);
  if (
    id === 0n ||
    bucketRetrievalSource[0] === "REQUESTED-WITH-MAPPING" ||
    bucketRetrievalSource[1] === "NO-LOCAL-MAPPING-APPLIED" ||
    isZoomThresholdExceededForAgglomerateMapping(state, layerName)
  ) {
    return id;
  }
  const mappingName = bucketRetrievalSource[2];
  // getBucketRetrievalSourceFn reuses the tuple instance as long as it's equal.
  const hasMappingChanged = () =>
    getBucketRetrievalSourceFn(layerName)(Store.getState()) !== bucketRetrievalSource;
  const { mappingType } = getMappingInfo(
    state.temporaryConfiguration.activeMappingByLayer,
    layerName,
  );

  if (mappingType === "JSON") {
    await waitForState(
      (currentState) =>
        hasMappingChanged() ||
        getMappingInfo(currentState.temporaryConfiguration.activeMappingByLayer, layerName)
          .mapping != null,
      `The data of the mapping ${mappingName} wasn't loaded within ${MAPPING_DATA_TIMEOUT_MS / 1000} seconds.`,
    );
    return hasMappingChanged() ? null : mapId(Store.getState(), layerName, id);
  }

  const locallyMappedId = mapId(state, layerName, id);
  if (locallyMappedId != null) {
    return locallyMappedId;
  }
  const fetchedId = await fetchMappedId(state, layerName, mappingName, id);
  return hasMappingChanged() ? null : (fetchedId ?? 0n);
}

function waitForState(
  predicate: (state: WebknossosState) => boolean,
  timeoutErrorMessage: string,
): Promise<void> {
  if (predicate(Store.getState())) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      unsubscribe();
      reject(new Error(timeoutErrorMessage));
    }, MAPPING_DATA_TIMEOUT_MS);
    const unsubscribe = Store.subscribe(() => {
      if (predicate(Store.getState())) {
        clearTimeout(timeoutId);
        unsubscribe();
        resolve();
      }
    });
  });
}

// Fetches the id that the given unmapped id has under the given HDF5 mapping. Returns null if the
// server has no entry for the id.
async function fetchMappedId(
  state: WebknossosState,
  layerName: string,
  mappingName: string,
  unmappedId: bigint,
): Promise<bigint | null> {
  const fetchedEntries = await fetchAgglomeratesForSegmentIds(
    state.dataset,
    state.annotation,
    getEditableMappingForVolumeTracingId(state, layerName),
    layerName,
    getLayerByName(state.dataset, layerName),
    mappingName,
    new Set([unmappedId]),
  );
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
