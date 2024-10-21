import type { EnqueueFunction } from "oxalis/model/bucket_data_handling/layer_rendering_manager";
import type { Matrix4x4 } from "libs/mjs";
import { M4x4, V3 } from "libs/mjs";
import {
  globalPositionToBucketPosition,
  globalPositionToBucketPositionFloat,
  zoomedAddressToAnotherZoomStep,
} from "oxalis/model/helpers/position_converter";
import type { BucketAddress, Vector3, Vector4 } from "oxalis/constants";
import constants from "oxalis/constants";
import { map3, map4, mod } from "libs/utils";

const aggregatePerDimension = (
  aggregateFn: (...args: number[]) => number,
  buckets: BucketAddress[],
): Vector3 => map3((dim) => aggregateFn(...buckets.map((pos) => pos[dim] as number)), [0, 1, 2]);

const getBBox = (buckets: BucketAddress[]) => ({
  cornerMin: aggregatePerDimension(Math.min, buckets),
  cornerMax: aggregatePerDimension(Math.max, buckets),
});

function createDistinctBucketAdder(bucketsWithPriorities: Array<[Vector4, number]>) {
  const bucketLookUp: boolean[][][] = [];

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
  mags: Array<Vector3>,
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
  const cameraVertex: Vector3 = [0, 0, -sphericalCapRadius];
  const fallbackZoomStep = logZoomStep + 1;
  const isFallbackAvailable = fallbackZoomStep < mags.length;

  const transformToSphereCap = (_vec: Vector3) => {
    const vec = V3.sub(_vec, cameraVertex);
    V3.scale(vec, sphericalCapRadius / V3.length(vec), vec);
    V3.add(vec, cameraVertex, vec);
    return vec;
  };

  const transformAndApplyMatrix = (vec: Vector3): Vector3 =>
    // @ts-ignore
    M4x4.transformPointsAffine(queryMatrix, transformToSphereCap(vec));

  let traversedBucketsWithPriorities: Array<[Vector4, number]> = [];
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
        transformedVec as Vector3,
        mags,
        logZoomStep,
      );

      const flooredBucketPos: Vector4 = map4(Math.floor, bucketPos);
      const priority = Math.abs(x) + Math.abs(y);
      maybeAddBucket(flooredBucketPos, priority);
      const neighbourThreshold = 3;
      bucketPos.forEach((pos: number, idx: number) => {
        const newNeighbour = flooredBucketPos.slice() as Vector4;
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
  const planePoints: Vector3[] = [
    [-halfWidth, -halfWidth, 0], // 0 bottom left
    [halfWidth, -halfWidth, 0], // 1 bottom right
    [0, 0, 0],
    [-halfWidth, halfWidth, 0], // 3 top left
    [halfWidth, halfWidth, 0], // 4 top right
  ];
  const planePointsGlobal = planePoints.map((vec) => transformAndApplyMatrix(vec));
  const planeBuckets = planePointsGlobal.map((position: Vector3) =>
    // null is passed as additionalCoordinates, since the bucket picker doesn't care about the
    // additional coordinates. It simply sticks to 3D and the caller is responsible for augmenting
    // potential other coordinates.
    globalPositionToBucketPosition(position, mags, logZoomStep, null),
  );

  const traverseFallbackBBox = (boundingBoxBuckets: {
    cornerMin: Vector3;
    cornerMax: Vector3;
  }): Vector4[] => {
    const tolerance = 1;
    const fallbackBuckets: Vector4[] = [];
    // use all fallback buckets in bbox
    const min = zoomedAddressToAnotherZoomStep(
      [...boundingBoxBuckets.cornerMin, logZoomStep],
      mags,
      fallbackZoomStep,
    );
    const max = zoomedAddressToAnotherZoomStep(
      [...boundingBoxBuckets.cornerMax, logZoomStep],
      mags,
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
    fallbackBuckets.map((bucket: Vector4) => [bucket, fallbackPriority]),
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
