// @flow
import { type Area } from "oxalis/model/accessors/flycam_accessor";
import type { EnqueueFunction } from "oxalis/model/bucket_data_handling/layer_rendering_manager";
import type { LoadingStrategy } from "oxalis/store";
import {
  type OrthoViewMap,
  OrthoViewValuesWithoutTDView,
  type Vector3,
  type Vector4,
} from "oxalis/constants";
import { getAddressSpaceDimensions } from "oxalis/model/bucket_data_handling/data_rendering_logic";
import {
  getMaxZoomStepDiff,
  getPriorityWeightForZoomStepDiff,
} from "oxalis/model/bucket_data_handling/loading_strategy_logic";
import { zoomedAddressToAnotherZoomStep } from "oxalis/model/helpers/position_converter";
import Dimensions from "oxalis/model/dimensions";
import ThreeDMap from "libs/ThreeDMap";

import { extraBucketPerEdge } from "./orthogonal_bucket_picker_constants";

export const getAnchorPositionToCenterDistance = (bucketPerDim: number) =>
  // Example I:
  // - bucketPerDim is 17 (because the actual plane is 16 buckets wide and we need one extra bucket to render a "half bucket" on each side)
  // --> the bucket distance between anchorPoint and center bucket is 8
  // Example II:
  // - bucketPerDim is 16 (because the actual plane is 15 buckets wide...)
  // --> the bucket distance between anchorPoint and center bucket is 8
  Math.ceil((bucketPerDim - 1) / 2);

export default function determineBucketsForOrthogonal(
  resolutions: Array<Vector3>,
  enqueueFunction: EnqueueFunction,
  loadingStrategy: LoadingStrategy,
  logZoomStep: number,
  anchorPoint: Vector4,
  areas: OrthoViewMap<Area>,
  subBucketLocality: Vector3,
  abortLimit?: ?number,
  gpuFactor: number,
) {
  let zoomStepDiff = 0;

  while (
    logZoomStep + zoomStepDiff < resolutions.length &&
    zoomStepDiff <= getMaxZoomStepDiff(loadingStrategy)
  ) {
    addNecessaryBucketsToPriorityQueueOrthogonal(
      resolutions,
      enqueueFunction,
      loadingStrategy,
      logZoomStep,
      zoomStepDiff,
      anchorPoint,
      areas,
      subBucketLocality,
      abortLimit,
      gpuFactor,
    );
    zoomStepDiff++;
  }
}

function addNecessaryBucketsToPriorityQueueOrthogonal(
  resolutions: Array<Vector3>,
  enqueueFunction: EnqueueFunction,
  loadingStrategy: LoadingStrategy,
  nonFallbackLogZoomStep: number,
  zoomStepDiff: number,
  nonFallbackAnchorPoint: Vector4,
  areas: OrthoViewMap<Area>,
  subBucketLocality: Vector3,
  abortLimit: ?number,
  gpuFactor: number,
): void {
  const logZoomStep = nonFallbackLogZoomStep + zoomStepDiff;
  const isFallback = zoomStepDiff > 0;
  const uniqueBucketMap = new ThreeDMap();
  let currentCount = 0;

  const enqueueAll = () => {
    for (const { bucketAddress, priority } of uniqueBucketMap.values()) {
      enqueueFunction(bucketAddress, priority);
    }
  };

  for (const planeId of OrthoViewValuesWithoutTDView) {
    // If the viewport is not visible, no buckets need to be added
    if (!areas[planeId].isVisible) continue;

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

    const addressSpaceDimensions = getAddressSpaceDimensions(gpuFactor);
    const renderedBucketsPerDimension = addressSpaceDimensions[w];

    let topLeftBucket = ((nonFallbackAnchorPoint.slice(): any): Vector4);
    topLeftBucket[w] += getAnchorPositionToCenterDistance(renderedBucketsPerDimension);
    topLeftBucket = zoomedAddressToAnotherZoomStep(topLeftBucket, resolutions, logZoomStep);

    const centerBucketUV = [
      scaledTopLeftVector[u] + (scaledBottomRightVector[u] - scaledTopLeftVector[u]) / 2,
      scaledTopLeftVector[v] + (scaledBottomRightVector[v] - scaledTopLeftVector[v]) / 2,
    ];

    // Always use buckets in the current w slice, but also load either the previous or the next
    // slice (depending on locality within the current bucket).
    // Similar to `extraBucketPerEdge`, the PQ takes care of cases in which the additional slice
    // can't be loaded.
    const wSliceOffsets = isFallback ? [0] : [0, subBucketLocality[w]];
    const additionalPriorityWeight = getPriorityWeightForZoomStepDiff(
      loadingStrategy,
      zoomStepDiff,
    );

    // Build up priority queue
    // eslint-disable-next-line no-loop-func
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

          const isExtraBucket =
            y === extraYBucketStart ||
            y === extraYBucketEnd ||
            x === extraXBucketStart ||
            x === extraXBucketEnd;

          const priority =
            Math.abs(x - centerBucketUV[0]) +
            Math.abs(y - centerBucketUV[1]) +
            Math.abs(100 * wSliceOffset) +
            additionalPriorityWeight +
            (isExtraBucket ? 100 : 0);

          const bucketVector3 = ((bucketAddress.slice(0, 3): any): Vector3);
          const existingEntry = uniqueBucketMap.get(bucketVector3);
          if (existingEntry == null) {
            uniqueBucketMap.set(bucketVector3, { bucketAddress, priority });
            currentCount++;

            if (abortLimit != null && currentCount > abortLimit) {
              enqueueAll();
              return;
            }
          } else {
            const { priority: existingPriority } = existingEntry;
            if (priority < existingPriority) {
              uniqueBucketMap.set(bucketVector3, { bucketAddress, priority });
            }
          }
        }
      }
    });
  }
  enqueueAll();
}
