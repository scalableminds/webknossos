// @flow
import PriorityQueue from "js-priority-queue";
import type { Vector3, Vector4, OrthoViewMapType } from "oxalis/constants";
import constants, { OrthoViewValuesWithoutTDView } from "oxalis/constants";
import {
  getResolutionsFactors,
  zoomedAddressToAnotherZoomStep,
} from "oxalis/model/helpers/position_converter";
import Dimensions from "oxalis/model/dimensions";
import type { AreaType } from "oxalis/model/accessors/flycam_accessor";
import Binary from "oxalis/model/binary";

export default function determineBucketsForOrthogonal(
  binary: Binary,
  bucketQueue: PriorityQueue,
  logZoomStep: number,
  fallbackZoomStep: number,
  isFallbackAvailable: boolean,
  anchorPoint: Vector4,
  fallbackAnchorPoint: Vector4,
  areas: OrthoViewMapType<AreaType>,
  subBucketLocality: Vector3,
) {
  addNecessaryBucketsToPriorityQueueOrthogonal(
    binary,
    bucketQueue,
    logZoomStep,
    anchorPoint,
    false,
    areas,
    subBucketLocality,
  );

  if (isFallbackAvailable) {
    addNecessaryBucketsToPriorityQueueOrthogonal(
      binary,
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
  binary: Binary,
  bucketQueue: PriorityQueue,
  logZoomStep: number,
  zoomedAnchorPoint: Vector4,
  isFallback: boolean,
  areas: OrthoViewMapType<AreaType>,
  subBucketLocality: Vector3,
): void {
  const resolution = binary.layer.resolutions[logZoomStep];
  const previousResolution = binary.layer.resolutions[logZoomStep - 1];

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
      binary.layer.resolutions,
      logZoomStep,
    );
    const scaledBottomRightVector = zoomedAddressToAnotherZoomStep(
      bottomRightVector,
      binary.layer.resolutions,
      logZoomStep,
    );

    const renderedBucketsPerDimension = Math.ceil(
      constants.MAXIMUM_NEEDED_BUCKETS_PER_DIMENSION / resolutionChangeRatio[w],
    );
    const topLeftBucket = zoomedAnchorPoint.slice();
    topLeftBucket[w] += Math.floor((renderedBucketsPerDimension - 1) / 2);

    const centerBucketUV = [
      scaledTopLeftVector[u] + (scaledBottomRightVector[u] - scaledTopLeftVector[u]) / 2,
      scaledTopLeftVector[v] + (scaledBottomRightVector[v] - scaledTopLeftVector[v]) / 2,
    ];

    // By subtracting and adding 1 (extraBucket) to the bounds of y and x, we move
    // one additional bucket on each edge of the viewport to the GPU. This decreases the
    // chance of showing gray data, when moving the viewport. However, it might happen that
    // we do not have enough capacity to move these additional buckets to the GPU.
    // That's why, we are using a priority queue which orders buckets by manhattan distance to
    // the center bucket. We only consume that many items from the PQ, which we can handle on the
    // GPU.
    const extraBucket = 1;

    // Always use buckets in the current w slice, but also load either the previous or the next
    // slice (depending on locality within the current bucket).
    // Similar to `extraBucket`, the PQ takes care of cases in which the additional slice can't be
    // loaded.
    const wSliceOffsets = isFallback ? [0] : [0, subBucketLocality[w]];
    // fallback buckets should have lower priority
    const additionalPriorityWeight = isFallback ? 1000 : 0;

    // Build up priority queue
    wSliceOffsets.forEach(wSliceOffset => {
      const extraYBucketStart = scaledTopLeftVector[v] - extraBucket;
      const extraYBucketEnd = scaledBottomRightVector[v] + extraBucket;
      const extraXBucketStart = scaledTopLeftVector[u] - extraBucket;
      const extraXBucketEnd = scaledBottomRightVector[u] + extraBucket;

      for (let y = extraYBucketStart; y <= extraYBucketEnd; y++) {
        for (let x = extraXBucketStart; x <= extraXBucketEnd; x++) {
          const bucketAddress = ((topLeftBucket.slice(): any): Vector4);
          bucketAddress[u] = x;
          bucketAddress[v] = y;
          bucketAddress[w] += wSliceOffset;

          const bucket = binary.cube.getOrCreateBucket(bucketAddress);
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
