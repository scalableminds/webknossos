import LinkButton from "components/link_button";
import { V3 } from "libs/mjs";
import Toast from "libs/toast";
import type { ActionPattern } from "redux-saga/effects";
import { call, put, race, take, takeLatest } from "typed-redux-saga";
import type { AdditionalCoordinate } from "types/api_types";
import { WkDevFlags } from "viewer/api/wk_dev";
import type { BucketAddress, Vector3 } from "viewer/constants";
import Constants, { MappingStatusEnum } from "viewer/constants";
import {
  getLayerByName,
  getMagInfo,
  getMappingInfo,
  getVisibleSegmentationLayer,
} from "viewer/model/accessors/dataset_accessor";
import { layerToGlobalTransformedPosition } from "viewer/model/accessors/dataset_layer_transformation_accessor";
import { getVolumeTracingByLayerName } from "viewer/model/accessors/volumetracing_accessor";
import type { Action } from "viewer/model/actions/actions";
import {
  setAdditionalCoordinatesAction,
  setPositionAction,
} from "viewer/model/actions/flycam_actions";
import type { NavigateToSegmentAction } from "viewer/model/actions/volumetracing_actions";
import {
  removeSegmentAction,
  updateSegmentAction,
} from "viewer/model/actions/volumetracing_actions";
import type DataCube from "viewer/model/bucket_data_handling/data_cube";
import type { Saga } from "viewer/model/sagas/effect_generators";
import { select } from "viewer/model/sagas/effect_generators";
import {
  getChunkPositionsFromSegmentIndex,
  getLayerSourceInfo,
  getUsePositionsFromSegmentIndex,
} from "viewer/model/sagas/meshes/segment_index_helpers";
import { api, Model } from "viewer/singletons";
import Store from "viewer/store";

// Only look into the bucket(s) immediately surrounding the anchor. With this
// small radius the search usually touches a single bucket at the finest mag
// (unless the anchor sits right next to a bucket border). If the segment is not
// found there, the search escalates to coarser mags (whose downsampled voxels
// represent the segment over a larger area) and finally to the segment index
// (if available).
const SEGMENT_ANCHOR_SEARCH_RADIUS = 4; // voxels in layer space (mag 1)
const SEGMENT_ANCHOR_MISMATCH_TOAST_KEY = "segment-anchor-mismatch";
const SEGMENT_ANCHOR_SEARCH_TOAST_KEY = "segment-anchor-search";

type AdditionalCoordinates = AdditionalCoordinate[] | null | undefined;

type ValidationResult =
  | { status: "valid" }
  | { status: "unavailable" }
  | { status: "found"; position: Vector3 }
  | { status: "not-found" };

/**
 * Returns all bucket addresses whose spatial extent overlaps the cubic bounding
 * box `[center ± searchRadius]` at the given magnification.
 *
 * Coordinates are in layer space (voxels at mag 1×1×1). The returned addresses
 * can be passed directly to `DataCube.getLoadedBucket`.
 */
function getBucketAddressesInBoundingBox(
  center: Vector3,
  searchRadius: number,
  mag: Vector3,
  magIndex: number,
  additionalCoordinates: AdditionalCoordinates,
): BucketAddress[] {
  const BW = Constants.BUCKET_WIDTH;
  const addresses: BucketAddress[] = [];

  for (let dim = 0; dim < 3; dim++) {
    if (center[dim] < 0) return addresses; // degenerate center
  }
  const bucketScale: Vector3 = [BW * mag[0], BW * mag[1], BW * mag[2]];
  const searchRadiusVec: Vector3 = [searchRadius, searchRadius, searchRadius];
  const minBucket = V3.max(
    V3.floor(V3.divide3(V3.sub(center, searchRadiusVec), bucketScale)),
    [0, 0, 0],
  );
  const maxBucket = V3.floor(V3.divide3(V3.add(center, searchRadiusVec), bucketScale));

  for (let bucketX = minBucket[0]; bucketX <= maxBucket[0]; bucketX++) {
    for (let bucketY = minBucket[1]; bucketY <= maxBucket[1]; bucketY++) {
      for (let bucketZ = minBucket[2]; bucketZ <= maxBucket[2]; bucketZ++) {
        addresses.push([bucketX, bucketY, bucketZ, magIndex, additionalCoordinates || []]);
      }
    }
  }
  return addresses;
}

/**
 * Scans the given buckets for voxels that belong to `segmentId` and returns the
 * matching voxel **closest to** `anchorPosition` (in layer space), or `null` if
 * none is found.
 *
 * Each bucket is loaded on-demand. When a mapping is active, the raw voxel
 * values are mapped via `cube.mapId` before comparing (so that merger mode, JSON
 * and HDF5 mappings work); the mapping results are cached per distinct raw id.
 * Without an active mapping, buckets that don't contain the id at all are skipped
 * cheaply via `bucket.containsValue`.
 */
function* scanBucketsForSegment(
  cube: DataCube,
  bucketAddresses: BucketAddress[],
  segmentId: number,
  mag: Vector3,
  anchorPosition: Vector3,
  useMapping: boolean,
): Saga<Vector3 | null> {
  const BW = Constants.BUCKET_WIDTH;
  const mapCache = new Map<number, number>();
  let best: Vector3 | null = null;
  let bestDistanceSq = Number.POSITIVE_INFINITY;

  for (const bucketAddress of bucketAddresses) {
    const bucket = yield* call([cube, cube.getLoadedBucket], bucketAddress);
    if (bucket.type === "null" || !bucket.hasData()) continue;
    if (!useMapping && !bucket.containsValue(segmentId)) continue;

    const data = bucket.getData();
    const [bucketX, bucketY, bucketZ] = bucketAddress;
    for (let i = 0; i < data.length; i++) {
      const rawValue = Number(data[i]);
      let value = rawValue;
      if (useMapping) {
        const cached = mapCache.get(rawValue);
        if (cached != null) {
          value = cached;
        } else {
          value = cube.mapId(rawValue);
          mapCache.set(rawValue, value);
        }
      }
      if (value !== segmentId) continue;

      const x = (bucketX * BW + (i % BW)) * mag[0];
      const y = (bucketY * BW + (Math.floor(i / BW) % BW)) * mag[1];
      const z = (bucketZ * BW + Math.floor(i / (BW * BW))) * mag[2];
      const dx = x - anchorPosition[0];
      const dy = y - anchorPosition[1];
      const dz = z - anchorPosition[2];
      const distanceSq = dx * dx + dy * dy + dz * dz;
      if (distanceSq < bestDistanceSq) {
        bestDistanceSq = distanceSq;
        best = [x, y, z];
      }
    }
  }
  return best;
}

/**
 * Searches for `segmentId` in a small bounding box around `anchorPosition`,
 * starting at the finest magnification and escalating to coarser mags until the
 * segment is found. Returns the matching layer-space position, or `null`.
 */
function* searchInLocalBuckets(
  layerName: string,
  anchorPosition: Vector3,
  segmentId: number,
  additionalCoordinates: AdditionalCoordinates,
): Saga<Vector3 | null> {
  const dataset = yield* select((state) => state.dataset);
  const magInfo = getMagInfo(getLayerByName(dataset, layerName).mags);
  const cube = Model.getCubeByLayerName(layerName);
  const useMapping = cube.isMappingEnabled();

  // getMagsWithIndices() is sorted from finest to coarsest.
  for (const [magIndex, mag] of magInfo.getMagsWithIndices()) {
    const bucketAddresses = getBucketAddressesInBoundingBox(
      anchorPosition,
      SEGMENT_ANCHOR_SEARCH_RADIUS,
      mag,
      magIndex,
      additionalCoordinates,
    );
    const found = yield* call(
      scanBucketsForSegment,
      cube,
      bucketAddresses,
      segmentId,
      mag,
      anchorPosition,
      useMapping,
    );
    if (found != null) return found;
  }
  return null;
}

/**
 * Uses the segment index (if available) to find where the segment currently is,
 * even if it has moved far away from the stored anchor. The segment index lookup
 * happens on the server and respects the active mapping, so this also handles
 * mapped ids. The reported chunk closest to the anchor is then refined locally
 * into an exact voxel. Returns `null` if there is no segment index, the lookup
 * fails, or the exact voxel cannot be determined.
 */
function* searchViaSegmentIndex(
  layerName: string,
  anchorPosition: Vector3,
  segmentId: number,
  additionalCoordinates: AdditionalCoordinates,
): Saga<Vector3 | null> {
  const state = yield* select((s) => s);
  const { dataset, annotation } = state;

  const visibleSegmentationLayer = getVisibleSegmentationLayer(state);
  // The navigation is triggered for the visible segmentation layer; bail out if
  // that assumption no longer holds.
  if (visibleSegmentationLayer == null || visibleSegmentationLayer.name !== layerName) {
    return null;
  }
  const volumeTracing = getVolumeTracingByLayerName(annotation, layerName);

  const usePositionsFromSegmentIndex = yield* call(
    getUsePositionsFromSegmentIndex,
    volumeTracing,
    dataset,
    layerName,
    visibleSegmentationLayer.tracingId,
  );
  if (!usePositionsFromSegmentIndex) return null;

  const magInfo = getMagInfo(getLayerByName(dataset, layerName).mags);
  const finestMagIndex = magInfo.getFinestMagIndex();
  const mag = magInfo.getMagByIndexOrThrow(finestMagIndex);
  const cube = Model.getCubeByLayerName(layerName);
  const useMapping = cube.isMappingEnabled();

  const mappingInfo = getMappingInfo(state.temporaryConfiguration.activeMappingByLayer, layerName);
  const mappingName =
    mappingInfo.mappingStatus === MappingStatusEnum.ENABLED ? mappingInfo.mappingName : null;

  const layerSourceInfo = getLayerSourceInfo(
    dataset,
    annotation,
    visibleSegmentationLayer,
    volumeTracing,
  );

  const cubeSize = WkDevFlags.meshing.marchingCubeSizeInTargetMag;
  let sortedPositions: Vector3[];
  try {
    sortedPositions = yield* call(
      getChunkPositionsFromSegmentIndex,
      layerSourceInfo,
      segmentId,
      cubeSize,
      mag,
      anchorPosition,
      additionalCoordinates,
      mappingName,
      annotation.version,
    );
  } catch (_e) {
    return null;
  }
  if (sortedPositions.length === 0) return null;

  // Refine the chunk closest to the anchor into an exact voxel. The chunk size
  // (marchingCubeSizeInTargetMag) is given in the target mag, so convert it to
  // the layer-space radius that the local scan expects.
  const searchRadius = Math.max(...cubeSize) * Math.max(...mag);
  const bucketAddresses = getBucketAddressesInBoundingBox(
    sortedPositions[0],
    searchRadius,
    mag,
    finestMagIndex,
    additionalCoordinates,
  );
  return yield* call(
    scanBucketsForSegment,
    cube,
    bucketAddresses,
    segmentId,
    mag,
    anchorPosition,
    useMapping,
  );
}

/**
 * Reads the (mapped) value at the stored anchor and, if it no longer matches
 * `segmentId`, searches for the segment nearby. The lookups respect the active
 * mapping, so this works for merger mode, JSON and HDF5 mappings as well as
 * proofreading.
 */
function* validateAnchor(action: NavigateToSegmentAction): Saga<ValidationResult> {
  const { segmentId, anchorPosition, additionalCoordinates, layerName } = action;

  let anchorValue: number;
  try {
    anchorValue = yield* call(
      [api.data, api.data.getMappedDataValue],
      layerName,
      anchorPosition,
      null,
      additionalCoordinates ?? null,
    );
  } catch (_e) {
    // Data unavailable — keep the optimistic navigation without validation.
    return { status: "unavailable" };
  }

  if (anchorValue === segmentId) return { status: "valid" };

  // Anchor is stale — let the user know that we are now searching nearby.
  Toast.info(
    `The stored position of segment ${segmentId} no longer contains its ID. Searching for the segment nearby…`,
    { key: SEGMENT_ANCHOR_SEARCH_TOAST_KEY },
  );

  let found = yield* call(
    searchInLocalBuckets,
    layerName,
    anchorPosition,
    segmentId,
    additionalCoordinates,
  );
  if (found == null) {
    found = yield* call(
      searchViaSegmentIndex,
      layerName,
      anchorPosition,
      segmentId,
      additionalCoordinates,
    );
  }

  return found != null ? { status: "found", position: found } : { status: "not-found" };
}

/**
 * Moves the viewport to the given `layerPosition` (layer space) by converting it
 * to global space via the layer's transform and dispatching the appropriate
 * flycam actions. Also updates the additional coordinates when provided.
 */
function* navigateToLayerPosition(
  layerName: string,
  layerPosition: Vector3,
  additionalCoordinates: AdditionalCoordinates,
): Saga<void> {
  const state = yield* select((s) => s);
  const globalPosition = layerToGlobalTransformedPosition(
    layerPosition,
    layerName,
    "segmentation",
    state,
  );
  yield* put(setPositionAction(globalPosition));
  if (additionalCoordinates != null && additionalCoordinates.length > 0) {
    yield* put(setAdditionalCoordinatesAction(additionalCoordinates));
  }
}

/**
 * Saga handler for `NAVIGATE_TO_SEGMENT`.
 *
 * Navigation happens **immediately** (optimistically) to the stored anchor.
 * Afterwards, the anchor is validated and—if it has become stale—the segment is
 * searched for nearby. This (potentially slow) validation is aborted when
 * - a newer NAVIGATE_TO_SEGMENT arrives (via `takeLatest`),
 * - the segment is removed by the user, or
 * - the segment's anchor position is changed (e.g. by brushing).
 */
function* navigateToSegment(action: NavigateToSegmentAction): Saga<void> {
  const { segmentId, anchorPosition, additionalCoordinates, layerName } = action;

  // 1. Navigate immediately (optimistically); validation happens afterwards.
  yield* call(navigateToLayerPosition, layerName, anchorPosition, additionalCoordinates);

  try {
    // 2. Validate/search, but abort if the segment is removed or its anchor
    //    changes in the meantime.
    const { result } = yield* race({
      result: call(validateAnchor, action),
      canceledByRemoval: take(
        ((a: Action) =>
          a.type === "REMOVE_SEGMENT" &&
          a.segmentId === segmentId &&
          a.layerName === layerName) as ActionPattern,
      ),
      canceledByAnchorChange: take(
        ((a: Action) =>
          a.type === "UPDATE_SEGMENT" &&
          a.segmentId === segmentId &&
          a.layerName === layerName &&
          a.segment.anchorPosition != null) as ActionPattern,
      ),
    });

    if (result == null) {
      // The validation was aborted.
      return;
    }

    switch (result.status) {
      case "valid":
      case "unavailable":
        // Either the optimistic navigation was already correct, or we could not
        // validate; in both cases we stay at the anchor position.
        return;
      case "found": {
        yield* call(navigateToLayerPosition, layerName, result.position, additionalCoordinates);
        yield* put(updateSegmentAction(segmentId, { anchorPosition: result.position }, layerName));
        return;
      }
      case "not-found": {
        Toast.warning(
          <>
            The stored position of segment {segmentId} no longer contains this segment&apos;s ID and
            could not be found nearby — it was likely overwritten. To re-anchor it, activate segment{" "}
            {segmentId} and brush over the desired position.{" "}
            <LinkButton
              onClick={() => {
                Store.dispatch(removeSegmentAction(segmentId, layerName));
                Toast.close(SEGMENT_ANCHOR_MISMATCH_TOAST_KEY);
              }}
            >
              Remove segment
            </LinkButton>
          </>,
          { key: SEGMENT_ANCHOR_MISMATCH_TOAST_KEY, sticky: true },
        );
        return;
      }
    }
  } finally {
    // Always remove the "searching…" toast, also when the search was aborted.
    Toast.close(SEGMENT_ANCHOR_SEARCH_TOAST_KEY);
  }
}

export default function* watchNavigateToSegment(): Saga<void> {
  yield* takeLatest("NAVIGATE_TO_SEGMENT", navigateToSegment);
}
