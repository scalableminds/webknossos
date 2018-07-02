// @flow
import PriorityQueue from "js-priority-queue";
import { M4x4, V3 } from "libs/mjs";
import { getPosition } from "oxalis/model/accessors/flycam_accessor";
import {
  zoomedAddressToAnotherZoomStep,
  globalPositionToBucketPosition,
} from "oxalis/model/helpers/position_converter";
import type { Vector3, Vector4 } from "oxalis/constants";
import constants from "oxalis/constants";
import traverse from "oxalis/model/bucket_data_handling/bucket_traversals";
import _ from "lodash";
import type { Matrix4x4 } from "libs/mjs";
import Store from "oxalis/store";
import { chunk2 } from "oxalis/model/helpers/chunk";
import { getResolutions } from "oxalis/model/accessors/dataset_accessor";
import type DataCube from "oxalis/model/bucket_data_handling/data_cube";

const hashPosition = ([x, y, z]) => 2 ** 32 * x + 2 ** 16 * y + z;
const makeBucketsUnique = buckets => _.uniqBy(buckets, hashPosition);
export const getFallbackBuckets = (
  buckets: Vector4[],
  resolutions: Vector3[],
  fallbackZoomStep: number,
  isFallbackAvailable: boolean,
) =>
  isFallbackAvailable
    ? _.uniqBy(
        buckets.map((bucketAddress: Vector4) =>
          zoomedAddressToAnotherZoomStep(bucketAddress, resolutions, fallbackZoomStep),
        ),
        hashPosition,
      )
    : [];

export default function determineBucketsForOblique(
  cube: DataCube,
  bucketQueue: PriorityQueue,
  matrix: Matrix4x4,
  logZoomStep: number,
  fallbackZoomStep: number,
  isFallbackAvailable: boolean,
): void {
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
  const resolutions = getResolutions(Store.getState().dataset);
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

  const centerAddress = globalPositionToBucketPosition(
    getPosition(Store.getState().flycam),
    resolutions,
    logZoomStep,
  );

  for (const bucketAddress of traversedBuckets) {
    const bucket = cube.getOrCreateBucket(bucketAddress);

    if (bucket.type !== "null") {
      const priority = V3.sub(bucketAddress, centerAddress).reduce((a, b) => a + Math.abs(b), 0);
      bucketQueue.queue({ bucket, priority });
    }
  }
}
