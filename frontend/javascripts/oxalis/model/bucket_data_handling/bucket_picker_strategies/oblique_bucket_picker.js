// @flow
import _ from "lodash";

import type { EnqueueFunction } from "oxalis/model/bucket_data_handling/layer_rendering_manager";
import { M4x4, type Matrix4x4, V3 } from "libs/mjs";
import { chunk2 } from "oxalis/model/helpers/chunk";
import {
  zoomedAddressToAnotherZoomStep,
  globalPositionToBucketPosition,
} from "oxalis/model/helpers/position_converter";
import ThreeDMap from "libs/ThreeDMap";
import constants, { type Vector3, type Vector4 } from "oxalis/constants";
import traverse from "oxalis/model/bucket_data_handling/bucket_traversals";

const hashPosition = ([x, y, z]) => 2 ** 32 * x + 2 ** 16 * y + z;
const makeBucketsUnique = (buckets: Vector3[]) => _.uniqBy(buckets, hashPosition);
export const getFallbackBuckets = (
  buckets: Vector4[],
  resolutions: Vector3[],
  fallbackZoomStep: number,
  isFallbackAvailable: boolean,
): Vector4[] =>
  isFallbackAvailable
    ? _.uniqBy(
        buckets.map((bucketAddress: Vector4) =>
          zoomedAddressToAnotherZoomStep(bucketAddress, resolutions, fallbackZoomStep),
        ),
        hashPosition,
      )
    : [];

export default function determineBucketsForOblique(
  resolutions: Array<Vector3>,
  position: Vector3,
  enqueueFunction: EnqueueFunction,
  matrix: Matrix4x4,
  logZoomStep: number,
  fallbackZoomStep: number,
  isFallbackAvailable: boolean,
  abortLimit?: number,
): void {
  const uniqueBucketMap = new ThreeDMap();
  let currentCount = 0;
  const queryMatrix = M4x4.scale1(1, matrix);

  // Buckets adjacent to the current viewport are also loaded so that these
  // buckets are already on the GPU when the user moves a little.
  const enlargementFactor = 1.1;
  const enlargedExtent = constants.VIEWPORT_WIDTH * enlargementFactor;
  const steps = 25;
  const stepSize = enlargedExtent / steps;
  const enlargedHalfExtent = enlargedExtent / 2;

  // This array holds the start and end points
  // of horizontal lines which cover the entire rendered plane.
  // These "scan lines" are traversed to find out which buckets need to be
  // sent to the GPU.
  const scanLinesPoints = M4x4.transformVectorsAffine(
    queryMatrix,
    _.flatten(
      _.range(steps + 1).map(idx => [
        [-enlargedHalfExtent, -enlargedHalfExtent + idx * stepSize, -10],
        [enlargedHalfExtent, -enlargedHalfExtent + idx * stepSize, -10],
        [-enlargedHalfExtent, -enlargedHalfExtent + idx * stepSize, 10],
        [enlargedHalfExtent, -enlargedHalfExtent + idx * stepSize, 10],
      ]),
    ),
  );

  let traversedBuckets = _.flatten(
    chunk2(scanLinesPoints).map(([a, b]: [Vector3, Vector3]) =>
      traverse(a, b, resolutions, logZoomStep),
    ),
  );

  traversedBuckets = makeBucketsUnique(traversedBuckets);
  traversedBuckets = traversedBuckets.map(addr => [...addr, logZoomStep]);

  const fallbackBuckets = getFallbackBuckets(
    traversedBuckets,
    resolutions,
    fallbackZoomStep,
    isFallbackAvailable,
  );

  traversedBuckets = traversedBuckets.concat(fallbackBuckets);

  const centerAddress = globalPositionToBucketPosition(position, resolutions, logZoomStep);

  for (const bucketAddress of traversedBuckets) {
    const bucketVector3 = ((bucketAddress.slice(0, 3): any): Vector3);
    if (uniqueBucketMap.get(bucketVector3) == null) {
      uniqueBucketMap.set(bucketVector3, bucketAddress);
      currentCount++;
      if (abortLimit != null && currentCount > abortLimit) {
        return;
      }
      const priority = V3.sub(bucketAddress, centerAddress).reduce((a, b) => a + Math.abs(b), 0);
      enqueueFunction(bucketAddress, priority);
    }
  }
}
