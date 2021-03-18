// @flow
import type { EnqueueFunction } from "oxalis/model/bucket_data_handling/layer_rendering_manager";
import { M4x4, type Matrix4x4, V3 } from "libs/mjs";
import {
  globalPositionToBucketPosition,
  globalPositionToBucketPositionFloat,
  zoomedAddressToAnotherZoomStep,
} from "oxalis/model/helpers/position_converter";
import constants, { type Vector3, type Vector4 } from "oxalis/constants";
import { mod } from "libs/utils";

const aggregatePerDimension = (aggregateFn, buckets): Vector3 =>
  // $FlowIssue[invalid-tuple-arity]
  [0, 1, 2].map(dim => aggregateFn(...buckets.map(pos => pos[dim])));

const getBBox = buckets => ({
  cornerMin: aggregatePerDimension(Math.min, buckets),
  cornerMax: aggregatePerDimension(Math.max, buckets),
});

function createDistinctBucketAdder(bucketsWithPriorities: Array<[Vector4, number]>) {
  const bucketLookUp = [];
  const maybeAddBucket = (bucketPos: Vector4, priority: number) => {
    const [x, y, z] = bucketPos;
    bucketLookUp[x] = bucketLookUp[x] || [];
    const lookupX = bucketLookUp[x];
    lookupX[y] = lookupX[y] || [];
    const lookupY = lookupX[y];

    if (!lookupY[z]) {
      lookupY[z] = true;
      bucketsWithPriorities.push([bucketPos, priority]);
    }
  };

  return maybeAddBucket;
}

export default function determineBucketsForFlight(
  resolutions: Array<Vector3>,
  centerPosition: Vector3,
  sphericalCapRadius: number,
  enqueueFunction: EnqueueFunction,
  matrix: Matrix4x4,
  logZoomStep: number,
  abortLimit?: number,
): void {
  const queryMatrix = M4x4.scale1(1, matrix);
  const width = constants.VIEWPORT_WIDTH;
  const halfWidth = width / 2;
  const cameraVertex = [0, 0, -sphericalCapRadius];
  const fallbackZoomStep = logZoomStep + 1;
  const isFallbackAvailable = fallbackZoomStep < resolutions.length;

  const transformToSphereCap = _vec => {
    const vec = V3.sub(_vec, cameraVertex);
    V3.scale(vec, sphericalCapRadius / V3.length(vec), vec);
    V3.add(vec, cameraVertex, vec);
    return vec;
  };
  const transformAndApplyMatrix = vec =>
    M4x4.transformPointsAffine(queryMatrix, transformToSphereCap(vec));

  let traversedBucketsWithPriorities = [];
  const maybeAddBucket = createDistinctBucketAdder(traversedBucketsWithPriorities);

  const cameraPosition = M4x4.transformVectorsAffine(queryMatrix, [cameraVertex])[0];
  const cameraDirection = V3.sub(centerPosition, cameraPosition);
  V3.scale(cameraDirection, 1 / Math.abs(V3.length(cameraDirection)), cameraDirection);

  const iterStep = 8;
  for (let y = -halfWidth; y <= halfWidth; y += iterStep) {
    const xOffset = mod(y, iterStep);
    for (let x = -halfWidth - xOffset; x <= halfWidth + xOffset; x += iterStep) {
      const z = 0;
      const transformedVec = transformAndApplyMatrix([x, y, z]);

      const bucketPos = globalPositionToBucketPositionFloat(
        transformedVec,
        resolutions,
        logZoomStep,
      );

      // $FlowIssue[invalid-tuple-arity]
      const flooredBucketPos: Vector4 = bucketPos.map(Math.floor);

      const priority = Math.abs(x) + Math.abs(y);
      maybeAddBucket(flooredBucketPos, priority);

      const neighbourThreshold = 3;
      // $FlowIssue[incompatible-call] bucketPos is a Vector4, so idx can only be 0 to 3
      bucketPos.forEach((pos, idx: 0 | 1 | 2 | 3) => {
        // $FlowIssue[invalid-tuple-arity]
        const newNeighbour: Vector4 = flooredBucketPos.slice();
        const rest = (pos % 1) * constants.BUCKET_WIDTH;
        if (rest < neighbourThreshold) {
          // Pick the previous neighbor
          newNeighbour[idx]--;
          maybeAddBucket(newNeighbour, priority);
        } else if (rest > constants.BUCKET_WIDTH - neighbourThreshold) {
          // Pick the next neighbor
          newNeighbour[idx]++;
          maybeAddBucket(newNeighbour, priority);
        }
      });
    }
  }

  // This array holds the four corners and the center point of the rendered plane
  const planePointsGlobal = [
    [-halfWidth, -halfWidth, 0], // 0 bottom left
    [halfWidth, -halfWidth, 0], // 1 bottom right
    [0, 0, 0],
    [-halfWidth, halfWidth, 0], // 3 top left
    [halfWidth, halfWidth, 0], // 4 top right
  ].map(transformAndApplyMatrix);

  const planeBuckets = planePointsGlobal.map((position: Vector3) =>
    globalPositionToBucketPosition(position, resolutions, logZoomStep),
  );

  const traverseFallbackBBox = boundingBoxBuckets => {
    const tolerance = 1;
    const fallbackBuckets = [];
    // use all fallback buckets in bbox
    const min = zoomedAddressToAnotherZoomStep(
      [...boundingBoxBuckets.cornerMin, logZoomStep],
      resolutions,
      fallbackZoomStep,
    );
    const max = zoomedAddressToAnotherZoomStep(
      [...boundingBoxBuckets.cornerMax, logZoomStep],
      resolutions,
      fallbackZoomStep,
    );
    for (let x = min[0] - tolerance; x <= max[0] + tolerance; x++) {
      for (let y = min[1] - tolerance; y <= max[1] + tolerance; y++) {
        for (let z = min[2] - tolerance; z <= max[2] + tolerance; z++) {
          fallbackBuckets.push([x, y, z, fallbackZoomStep]);
        }
      }
    }
    return fallbackBuckets;
  };

  const fallbackBuckets = isFallbackAvailable ? traverseFallbackBBox(getBBox(planeBuckets)) : [];
  // Use a constant priority for the fallback buckets which is higher than the highest non-fallback priority
  const fallbackPriority = 2 * halfWidth + iterStep;
  traversedBucketsWithPriorities = traversedBucketsWithPriorities.concat(
    fallbackBuckets.map(bucket => [bucket, fallbackPriority]),
  );

  let currentCount = 0;
  for (const [bucketAddress, priority] of traversedBucketsWithPriorities) {
    enqueueFunction(bucketAddress, priority);
    currentCount++;
    if (abortLimit != null && currentCount > abortLimit) {
      return;
    }
  }
}
