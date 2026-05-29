import LinkButton from "components/link_button";
import { V3 } from "libs/mjs";
import Toast from "libs/toast";
import { call, put, takeEvery } from "typed-redux-saga";
import type { BucketAddress, Vector3 } from "viewer/constants";
import Constants from "viewer/constants";
import { getLayerByName, getMagInfo } from "viewer/model/accessors/dataset_accessor";
import { layerToGlobalTransformedPosition } from "viewer/model/accessors/dataset_layer_transformation_accessor";
import {
  setAdditionalCoordinatesAction,
  setPositionAction,
} from "viewer/model/actions/flycam_actions";
import type { NavigateToSegmentAction } from "viewer/model/actions/volumetracing_actions";
import {
  removeSegmentAction,
  updateSegmentAction,
} from "viewer/model/actions/volumetracing_actions";
import type { globalPositionToBucketPosition } from "viewer/model/helpers/position_converter";
import type { Saga } from "viewer/model/sagas/effect_generators";
import { select } from "viewer/model/sagas/effect_generators";
import { api, Model } from "viewer/singletons";
import Store from "viewer/store";

const SEGMENT_ANCHOR_SEARCH_RADIUS = 150; // voxels in layer space
const SEGMENT_ANCHOR_MISMATCH_TOAST_KEY = "segment-anchor-mismatch";

/**
 * Returns all bucket addresses whose spatial extent overlaps the cubic bounding
 * box `[anchorPosition ± searchRadius]` at the given magnification level.
 *
 * Coordinates are in layer space (voxels at mag 1×1×1).  The returned
 * addresses can be passed directly to `DataCube.getLoadedBucket`.
 */
function getBucketAddressesInBoundingBox(
  anchorPosition: Vector3,
  searchRadius: number,
  magIndex: number,
  denseMags: Array<Vector3>,
  additionalCoords: Parameters<typeof globalPositionToBucketPosition>[3],
): BucketAddress[] {
  const mag = denseMags[magIndex] ?? ([1, 1, 1] as Vector3);
  const BW = Constants.BUCKET_WIDTH;
  const addresses: BucketAddress[] = [];

  for (let dim = 0; dim < 3; dim++) {
    if (anchorPosition[dim] < 0) return addresses; // degenerate anchor
  }
  const bucketScale: Vector3 = [BW * mag[0], BW * mag[1], BW * mag[2]];
  const searchRadiusVec: Vector3 = [searchRadius, searchRadius, searchRadius];
  const minBucket = V3.max(
    V3.floor(V3.divide3(V3.sub(anchorPosition, searchRadiusVec), bucketScale)),
    [0, 0, 0],
  );
  const maxBucket = V3.floor(V3.divide3(V3.add(anchorPosition, searchRadiusVec), bucketScale));

  for (let bucketX = minBucket[0]; bucketX <= maxBucket[0]; bucketX++) {
    for (let bucketY = minBucket[1]; bucketY <= maxBucket[1]; bucketY++) {
      for (let bucketZ = minBucket[2]; bucketZ <= maxBucket[2]; bucketZ++) {
        addresses.push([bucketX, bucketY, bucketZ, magIndex, additionalCoords || []]);
      }
    }
  }
  return addresses;
}

/**
 * Searches for voxels with `segmentId` within a cubic bounding box of radius
 * `SEGMENT_ANCHOR_SEARCH_RADIUS` around `anchorPosition` in layer space and
 * returns their **centroid**.
 *
 * Iterates over the overlapping buckets at the finest available magnification.
 * Each bucket is loaded on-demand; buckets that do not contain the target value
 * are skipped via `bucket.containsValue` (O(1) Set lookup) before scanning the
 * raw voxel data.
 *
 * Returns the layer-space centroid of all matching voxels, or `null` if the
 * segment is not found within the search radius.
 */
function* searchSegmentInBoundingBox(
  layerName: string,
  anchorPosition: Vector3,
  segmentId: number,
  additionalCoordinates: Parameters<typeof globalPositionToBucketPosition>[3],
): Saga<Vector3 | null> {
  const dataset = yield* select((state) => state.dataset);
  const layerInfo = getLayerByName(dataset, layerName);
  const magInfo = getMagInfo(layerInfo.mags);
  const finestMagIndex = magInfo.getFinestMagIndex();
  const denseMags = magInfo.getDenseMags();
  const mag = denseMags[finestMagIndex] ?? ([1, 1, 1] as Vector3);
  const cube = Model.getCubeByLayerName(layerName);
  const BW = Constants.BUCKET_WIDTH;

  const bucketAddresses = getBucketAddressesInBoundingBox(
    anchorPosition,
    SEGMENT_ANCHOR_SEARCH_RADIUS,
    finestMagIndex,
    denseMags,
    additionalCoordinates,
  );

  let sumX = 0;
  let sumY = 0;
  let sumZ = 0;
  let count = 0;

  for (const bucketAddress of bucketAddresses) {
    const bucket = yield* call([cube, cube.getLoadedBucket], bucketAddress);
    if (bucket.type === "null" || !bucket.hasData()) continue;
    if (!bucket.containsValue(segmentId)) continue;

    const data = bucket.getData();
    const [bucketX, bucketY, bucketZ] = bucketAddress;
    for (let i = 0; i < data.length; i++) {
      if (Number(data[i]) === segmentId) {
        const offsetX = i % BW;
        const offsetY = Math.floor(i / BW) % BW;
        const offsetZ = Math.floor(i / (BW * BW));
        sumX += (bucketX * BW + offsetX) * mag[0];
        sumY += (bucketY * BW + offsetY) * mag[1];
        sumZ += (bucketZ * BW + offsetZ) * mag[2];
        count++;
      }
    }
  }

  if (count === 0) return null;
  return [Math.round(sumX / count), Math.round(sumY / count), Math.round(sumZ / count)] as Vector3;
}

/**
 * Moves the viewport to the given `layerPosition` (layer space) by converting
 * it to global space via the layer's transform and dispatching the appropriate
 * flycam actions.  Also updates the additional coordinates when provided.
 */
function* navigateToLayerPosition(
  layerName: string,
  layerPosition: Vector3,
  additionalCoordinates: Parameters<typeof globalPositionToBucketPosition>[3],
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
 * Validates the segment's stored anchor position before navigating:
 *
 * 1. **Anchor valid** — the voxel at `anchorPosition` still holds `segmentId`:
 *    navigate there immediately.
 * 2. **Anchor stale** — the voxel has a different value: search a bounding box
 *    of radius `SEGMENT_ANCHOR_SEARCH_RADIUS` around the anchor.
 *    - Found → navigate to the centroid of discovered voxels and update the stored anchor.
 *    - Not found → show a sticky warning toast with an option to remove the
 *      segment from the list.
 * 3. **Data unavailable** (fetch error) — navigate to the stored anchor anyway
 *    without validation.
 */
function* navigateToSegment(action: NavigateToSegmentAction): Saga<void> {
  const { segmentId, anchorPosition, additionalCoordinates, layerName } = action;

  // Check if the anchor position still contains this segment's ID.
  let anchorValue: number;
  try {
    anchorValue = yield* call(
      [api.data, api.data.getDataValue],
      layerName,
      anchorPosition,
      null,
      additionalCoordinates ?? null,
    );
  } catch (_e) {
    // Data unavailable — navigate anyway without validation.
    yield* call(navigateToLayerPosition, layerName, anchorPosition, additionalCoordinates);
    return;
  }

  if (anchorValue === segmentId) {
    yield* call(navigateToLayerPosition, layerName, anchorPosition, additionalCoordinates);
    return;
  }

  // Anchor is stale — search the surrounding bounding box.
  const foundPosition = yield* call(
    searchSegmentInBoundingBox,
    layerName,
    anchorPosition,
    segmentId,
    additionalCoordinates,
  );

  if (foundPosition != null) {
    yield* call(navigateToLayerPosition, layerName, foundPosition, additionalCoordinates);
    yield* put(updateSegmentAction(segmentId, { anchorPosition: foundPosition }, layerName));
    return;
  }

  // Segment not found — show an explanatory warning with a remove option.
  Toast.warning(
    <>
      The stored position of segment {segmentId} no longer contains this segment&apos;s ID and could
      not be found nearby — it was likely overwritten. To re-anchor it, activate segment {segmentId}{" "}
      and brush over the desired position.{" "}
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
}

export default function* watchNavigateToSegment(): Saga<void> {
  yield* takeEvery("NAVIGATE_TO_SEGMENT", navigateToSegment);
}
