// @flow
import PriorityQueue from "js-priority-queue";
import { M4x4, V3 } from "libs/mjs";
import { getPosition } from "oxalis/model/accessors/flycam_accessor";
import {
  getResolutionsFactors,
  zoomedAddressToAnotherZoomStep,
  globalPositionToBucketPosition,
  bucketPositionToGlobalAddress,
  getBucketExtent,
} from "oxalis/model/helpers/position_converter";
import type { Vector3, Vector4, OrthoViewType, OrthoViewMapType } from "oxalis/constants";
import { traverse } from "oxalis/model/binary/bucket_traversals";
import _ from "lodash";
import type { Matrix4x4 } from "libs/mjs";
import Binary from "oxalis/model/binary";
import Utils from "libs/utils";
import Store from "oxalis/store";
import { chunk2 } from "oxalis/model/helpers/chunk";

export function determineBucketsForOblique(
  binary: Binary,
  bucketQueue: PriorityQueue,
  matrix: Matrix4x4,
  logZoomStep: number,
  fallbackZoomStep: number,
  isFallbackAvailable: boolean,
): void {
  const queryMatrix = M4x4.scale1(1, matrix);

  const enlargementFactor = 1.1;
  const enlargedExtent = 384 * enlargementFactor;
  // todo: tweak this number
  const steps = 25;
  const stepSize = enlargedExtent / steps;
  const enlargedHalfExtent = enlargedExtent / 2;
  const rotatedPlane = M4x4.transformVectorsAffine(
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
    chunk2(rotatedPlane).map(([a, b]: [Vector3, Vector3]) =>
      traverse(a, b, binary.layer.resolutions, logZoomStep),
    ),
  );
  const hashPosition = ([x, y, z]) => 2 ** 32 * x + 2 ** 16 * y + z;
  traversedBuckets = _.uniqBy(traversedBuckets, hashPosition);
  traversedBuckets = traversedBuckets.map(addr => [...addr, logZoomStep]);

  if (isFallbackAvailable) {
    traversedBuckets = _.uniqBy(
      _.flatMap(traversedBuckets, (bucketAddress: Vector4): Array<Vector4> => {
        return [
          bucketAddress,
          zoomedAddressToAnotherZoomStep(bucketAddress, binary.layer.resolutions, fallbackZoomStep),
        ];
      }),
      hashPosition,
    );
  }

  const missingBuckets = [];
  const centerAddress = globalPositionToBucketPosition(
    getPosition(Store.getState().flycam),
    binary.layer.resolutions,
    logZoomStep,
  );

  for (const bucketAddress of traversedBuckets) {
    const bucket = binary.cube.getOrCreateBucket(bucketAddress);

    if (bucket.type !== "null") {
      const priority = V3.sub(bucketAddress, centerAddress).reduce((a, b) => a + Math.abs(b), 0);

      bucketQueue.queue({ bucket, priority });

      if (!bucket.hasData()) {
        // Priority is set to -1 since we need these buckets need to be fetched immediately
        missingBuckets.push({ bucket: bucket.zoomedAddress, priority: -1 });
      }
    }
  }

  binary.pullQueue.addAll(missingBuckets);
  binary.pullQueue.pull();
}
