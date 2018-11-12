// @flow
import PriorityQueue from "js-priority-queue";

import type { APIDataset } from "admin/api_flow_types";
import { type Area, getMaxBucketCountPerDim } from "oxalis/model/accessors/flycam_accessor";
import { getBaseVoxelFactors } from "oxalis/model/scaleinfo";
import { getResolutions } from "oxalis/model/accessors/dataset_accessor";
import {
  getResolutionsFactors,
  zoomedAddressToAnotherZoomStep,
} from "oxalis/model/helpers/position_converter";
import type DataCube from "oxalis/model/bucket_data_handling/data_cube";
import Dimensions from "oxalis/model/dimensions";
import constants, {
  type OrthoViewMap,
  OrthoViewValuesWithoutTDView,
  type Vector3,
  type Vector4,
} from "oxalis/constants";

import { extraBucketPerEdge, extraBucketsPerDim } from "./orthogonal_bucket_picker_constants";

function getUnzoomedBucketCountPerDim(
  dataSetScale: Vector3,
  forFallback: boolean,
  zoomFactor: number,
): Vector3 {
  const baseVoxelFactors = getBaseVoxelFactors(dataSetScale);
  const necessaryVoxelsPerDim = baseVoxelFactors.map(f => f * constants.PLANE_WIDTH);

  const fallbackFactor = forFallback ? 0.5 : 1;
  const unzoomedBucketCountPerDim = necessaryVoxelsPerDim.map(
    // As an example, even if the viewport width corresponds to exactly
    // 16 buckets, a slight offset can mean that we need one additional bucket,
    // from which we render only a small fraction. That's why 1 is added.
    // Math.ceil is important since a raw viewport width ~ 15.8 bucket should also
    // result in 17 buckets.
    v => 1 + Math.ceil((zoomFactor * fallbackFactor * v) / constants.BUCKET_WIDTH),
  );
  return ((unzoomedBucketCountPerDim: any): Vector3);
}

export const calculateUnzoomedBucketCount = (dataSetScale: Vector3, zoomFactor: number = 1) => {
  // This function defines how many buckets this bucket picker needs at zoom level === 1.
  // The returned value serves as an upper bound and influences which magnification is selected
  // for a given zoom step.

  const calculateBucketCountForOrtho = ([x, y, z]) => {
    const xy = x * y;
    const xz = x * z - x;
    const yz = y * z - (y + z - 1);
    return xy + xz + yz;
  };
  const bucketsPerDim = getUnzoomedBucketCountPerDim(dataSetScale, false, zoomFactor);
  const fallbackBucketsPerDim = getUnzoomedBucketCountPerDim(dataSetScale, true, zoomFactor);

  const addExtraBuckets = vec => vec.map(el => el + extraBucketsPerDim);
  const calculateAdditionalWSliceCount = ([x, y, z]) => {
    const xy = x * y - (x + y - 1);
    const xz = x * z - (2 * x + z - 2);
    const yz = y * z - (2 * y + 2 * z - 4);
    return xy + xz + yz;
  };

  // For non-fallback buckets, we load two slices per plane (see usage of subBucketLocality)
  const normalBucketCount =
    calculateBucketCountForOrtho(addExtraBuckets(bucketsPerDim)) +
    calculateAdditionalWSliceCount(addExtraBuckets(bucketsPerDim));
  const fallbackBucketCount = calculateBucketCountForOrtho(addExtraBuckets(fallbackBucketsPerDim));

  return normalBucketCount + fallbackBucketCount;
};

export const getAnchorPositionToCenterDistance = (bucketPerDim: number) =>
  Math.ceil((bucketPerDim - 1) / 2);

export default function determineBucketsForOrthogonal(
  dataset: APIDataset,
  cube: DataCube,
  bucketQueue: PriorityQueue,
  logZoomStep: number,
  fallbackZoomStep: number,
  isFallbackAvailable: boolean,
  anchorPoint: Vector4,
  fallbackAnchorPoint: Vector4,
  areas: OrthoViewMap<Area>,
  subBucketLocality: Vector3,
) {
  addNecessaryBucketsToPriorityQueueOrthogonal(
    dataset,
    cube,
    bucketQueue,
    logZoomStep,
    anchorPoint,
    false,
    areas,
    subBucketLocality,
  );

  if (isFallbackAvailable) {
    addNecessaryBucketsToPriorityQueueOrthogonal(
      dataset,
      cube,
      bucketQueue,
      logZoomStep + 1,
      fallbackAnchorPoint,
      true,
      areas,
      subBucketLocality,
    );
  }
}

function addNecessaryBucketsToPriorityQueueOrthogonal(
  dataset: APIDataset,
  cube: DataCube,
  bucketQueue: PriorityQueue,
  logZoomStep: number,
  zoomedAnchorPoint: Vector4,
  isFallback: boolean,
  areas: OrthoViewMap<Area>,
  subBucketLocality: Vector3,
): void {
  const resolutions = getResolutions(dataset);
  const datasetScale = dataset.dataSource.scale;
  const resolution = resolutions[logZoomStep];
  const previousResolution = resolutions[logZoomStep - 1];

  const resolutionChangeRatio = isFallback
    ? getResolutionsFactors(resolution, previousResolution)
    : [1, 1, 1];

  for (const planeId of OrthoViewValuesWithoutTDView) {
    const [u, v, w] = Dimensions.getIndices(planeId);

    const topLeftVector = [0, 0, 0, 0];
    topLeftVector[v] = areas[planeId].top;
    topLeftVector[u] = areas[planeId].left;

    const bottomRightVector = [0, 0, 0, 0];
    bottomRightVector[v] = areas[planeId].bottom;
    bottomRightVector[u] = areas[planeId].right;

    const scaledTopLeftVector = zoomedAddressToAnotherZoomStep(
      topLeftVector,
      resolutions,
      logZoomStep,
    );
    const scaledBottomRightVector = zoomedAddressToAnotherZoomStep(
      bottomRightVector,
      resolutions,
      logZoomStep,
    );

    const bucketsPerDim = getMaxBucketCountPerDim(datasetScale);
    const renderedBucketsPerDimension = Math.ceil(bucketsPerDim[w] / resolutionChangeRatio[w]);

    const topLeftBucket = zoomedAnchorPoint.slice();
    topLeftBucket[w] += getAnchorPositionToCenterDistance(renderedBucketsPerDimension);

    const centerBucketUV = [
      scaledTopLeftVector[u] + (scaledBottomRightVector[u] - scaledTopLeftVector[u]) / 2,
      scaledTopLeftVector[v] + (scaledBottomRightVector[v] - scaledTopLeftVector[v]) / 2,
    ];

    // Always use buckets in the current w slice, but also load either the previous or the next
    // slice (depending on locality within the current bucket).
    // Similar to `extraBucketPerEdge`, the PQ takes care of cases in which the additional slice
    // can't be loaded.
    const wSliceOffsets = isFallback ? [0] : [0, subBucketLocality[w]];
    // fallback buckets should have lower priority
    const additionalPriorityWeight = isFallback ? 1000 : 0;

    // Build up priority queue
    wSliceOffsets.forEach(wSliceOffset => {
      const extraYBucketStart = scaledTopLeftVector[v] - extraBucketPerEdge;
      const extraYBucketEnd = scaledBottomRightVector[v] + extraBucketPerEdge;
      const extraXBucketStart = scaledTopLeftVector[u] - extraBucketPerEdge;
      const extraXBucketEnd = scaledBottomRightVector[u] + extraBucketPerEdge;

      for (let y = extraYBucketStart; y <= extraYBucketEnd; y++) {
        for (let x = extraXBucketStart; x <= extraXBucketEnd; x++) {
          const bucketAddress = ((topLeftBucket.slice(): any): Vector4);
          bucketAddress[u] = x;
          bucketAddress[v] = y;
          bucketAddress[w] += wSliceOffset;

          const bucket = cube.getOrCreateBucket(bucketAddress);
          const isExtraBucket =
            y === extraYBucketStart ||
            y === extraYBucketEnd ||
            x === extraXBucketStart ||
            x === extraXBucketEnd;

          if (bucket.type !== "null") {
            const priority =
              Math.abs(x - centerBucketUV[0]) +
              Math.abs(y - centerBucketUV[1]) +
              Math.abs(100 * wSliceOffset) +
              additionalPriorityWeight +
              (isExtraBucket ? 100 : 0);
            bucketQueue.queue({
              priority,
              bucket,
            });
          }
        }
      }
    });
  }
}
