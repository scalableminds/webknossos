// @flow
import PriorityQueue from "js-priority-queue";

import type { APIDataset } from "admin/api_flow_types";
import {
  type Area,
  getMaxBucketCountPerDim,
  getMaxBucketCountsForFallback,
} from "oxalis/model/accessors/flycam_accessor";
import { getBaseVoxelFactors } from "oxalis/model/scaleinfo";
import { getResolutions } from "oxalis/model/accessors/dataset_accessor";
import { zoomedAddressToAnotherZoomStep } from "oxalis/model/helpers/position_converter";
import { map3 } from "libs/utils";
import type DataCube from "oxalis/model/bucket_data_handling/data_cube";
import Dimensions from "oxalis/model/dimensions";
import constants, {
  type OrthoViewMap,
  OrthoViewValuesWithoutTDView,
  type Vector3,
  type Vector4,
} from "oxalis/constants";

import { extraBucketPerEdge, extraBucketsPerDim } from "./orthogonal_bucket_picker_constants";

/*
  This function returns the amount of buckets (per dimension) which are necessary
  to render data in the provided magnification **with a specific zoom factor**.
  For example, the function would answer how many buckets are necessary per dimension,
  if we want to render data with a zoom value of 3.5 in mag2.

  Instead of this function, try to use getMaxBucketCountPerDim where possible, as that function
  will pick the appropriate zoomFactor automatically.
*/
export function getBucketCountPerDim(
  dataSetScale: Vector3,
  resolutionIndex: number,
  resolutions: Array<Vector3>,
  zoomFactor: number,
): Vector3 {
  const addExtraBuckets = vec => map3(el => el + extraBucketsPerDim, vec);

  const baseVoxelFactors = getBaseVoxelFactors(dataSetScale);
  const necessaryVoxelsPerDim = map3(f => f * constants.PLANE_WIDTH, baseVoxelFactors);

  const resolutionFactor = resolutions[resolutionIndex];
  const bucketCountPerDim = map3(
    // As an example, even if the viewport width corresponds to exactly
    // 16 buckets, a slight offset can mean that we need one additional bucket,
    // from which we render only a small fraction. That's why 1 is added.
    // Math.ceil is important since a raw viewport width ~ 15.8 bucket should also
    // result in 17 buckets.
    (v, dim) => 1 + Math.ceil((zoomFactor * v) / (resolutionFactor[dim] * constants.BUCKET_WIDTH)),
    necessaryVoxelsPerDim,
  );

  return addExtraBuckets(bucketCountPerDim);
}

/*
  This function calculates how many buckets this bucket picker would need when rendering data in
  a specific magnification with a specific zoom factor.
  The returned value serves as an upper bound and influences which magnification is selected
  for a given zoom step.
*/
export const calculateBucketCountForZoomLevel = (
  dataSetScale: Vector3,
  resolutionIndex: number,
  resolutions: Array<Vector3>,
  zoomFactor: number,
) => {
  const calculateBucketCountForOrtho = ([x, y, z]) => {
    const xy = x * y;
    const xz = x * z - x;
    const yz = y * z - (y + z - 1);
    return xy + xz + yz;
  };
  const bucketsPerDim = getBucketCountPerDim(
    dataSetScale,
    resolutionIndex,
    resolutions,
    zoomFactor,
  );

  const fallbackBucketsPerDim =
    resolutionIndex + 1 < resolutions.length
      ? getBucketCountPerDim(dataSetScale, resolutionIndex + 1, resolutions, zoomFactor)
      : [0, 0, 0];

  const calculateAdditionalWSliceCount = ([x, y, z]) => {
    const xy = x * y - (x + y - 1);
    const xz = x * z - (2 * x + z - 2);
    const yz = y * z - (2 * y + 2 * z - 4);
    return xy + xz + yz;
  };

  // For non-fallback buckets, we load two slices per plane (see usage of subBucketLocality)
  const normalBucketCount =
    calculateBucketCountForOrtho(bucketsPerDim) + calculateAdditionalWSliceCount(bucketsPerDim);
  const fallbackBucketCount = calculateBucketCountForOrtho(fallbackBucketsPerDim);

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

    const bucketsPerDim = isFallback
      ? getMaxBucketCountsForFallback(datasetScale, logZoomStep, resolutions)
      : getMaxBucketCountPerDim(datasetScale, logZoomStep, resolutions);

    const renderedBucketsPerDimension = bucketsPerDim[w];

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
