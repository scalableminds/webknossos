// @flow
import PriorityQueue from "js-priority-queue";

import { M4x4, type Matrix4x4, V3 } from "libs/mjs";
import { getPosition } from "oxalis/model/accessors/flycam_accessor";
import { getResolutions } from "oxalis/model/accessors/dataset_accessor";
import {
  globalPositionToBucketPosition,
  globalPositionToBucketPositionFloat,
  zoomedAddressToAnotherZoomStep,
} from "oxalis/model/helpers/position_converter";
import type DataCube from "oxalis/model/bucket_data_handling/data_cube";
import Store from "oxalis/store";
import constants, { type Vector3, type Vector4 } from "oxalis/constants";

const aggregatePerDimension = (aggregateFn, buckets): Vector3 =>
  // $FlowFixMe
  [0, 1, 2].map(dim => aggregateFn(...buckets.map(pos => pos[dim])));

const getBBox = buckets => ({
  cornerMin: aggregatePerDimension(Math.min, buckets),
  cornerMax: aggregatePerDimension(Math.max, buckets),
});

function createDistinctBucketAdder(buckets: Array<Vector4>) {
  const bucketLookUp = [];
  const maybeAddBucket = (bucketPos: Vector4) => {
    const [x, y, z] = bucketPos;
    /* eslint-disable-next-line */
    bucketLookUp[x] = bucketLookUp[x] || [];
    const lookupX = bucketLookUp[x];
    /* eslint-disable-next-line */
    lookupX[y] = lookupX[y] || [];
    const lookupY = lookupX[y];

    if (!lookupY[z]) {
      lookupY[z] = true;
      buckets.push(bucketPos);
    }
  };

  return maybeAddBucket;
}

export default function determineBucketsForFlight(
  cube: DataCube,
  bucketQueue: PriorityQueue,
  matrix: Matrix4x4,
  logZoomStep: number,
  fallbackZoomStep: number,
  isFallbackAvailable: boolean,
): void {
  const { sphericalCapRadius } = Store.getState().userConfiguration;
  const resolutions = getResolutions(Store.getState().dataset);
  const centerPosition = getPosition(Store.getState().flycam);
  const queryMatrix = M4x4.scale1(1, matrix);
  const width = constants.VIEWPORT_WIDTH;
  const halfWidth = width / 2;
  const cameraVertex = [0, 0, -sphericalCapRadius];

  const transformToSphereCap = _vec => {
    const vec = V3.sub(_vec, cameraVertex);
    V3.scale(vec, sphericalCapRadius / V3.length(vec), vec);
    V3.add(vec, cameraVertex, vec);
    return vec;
  };
  const transformAndApplyMatrix = vec =>
    M4x4.transformPointsAffine(queryMatrix, transformToSphereCap(vec));

  let traversedBuckets = [];
  const maybeAddBucket = createDistinctBucketAdder(traversedBuckets);

  const cameraPosition = M4x4.transformVectorsAffine(queryMatrix, [cameraVertex])[0];
  const cameraDirection = V3.sub(centerPosition, cameraPosition);
  V3.scale(cameraDirection, 1 / Math.abs(V3.length(cameraDirection)), cameraDirection);

  const iterStep = 10;
  for (let y = -halfWidth; y <= halfWidth; y += iterStep) {
    const xOffset = y % iterStep;
    for (let x = -halfWidth - xOffset; x <= halfWidth + xOffset; x += iterStep) {
      const z = 0;
      const transformedVec = transformAndApplyMatrix([x, y, z]);

      const bucketPos = globalPositionToBucketPositionFloat(
        transformedVec,
        resolutions,
        logZoomStep,
      );

      // $FlowFixMe
      const flooredBucketPos: Vector4 = bucketPos.map(Math.floor);
      maybeAddBucket(flooredBucketPos);

      const neighbourThreshold = 3;
      bucketPos.forEach((pos, idx) => {
        // $FlowFixMe
        const newNeighbour: Vector4 = flooredBucketPos.slice();
        const rest = (pos % 1) * constants.BUCKET_WIDTH;
        if (rest < neighbourThreshold) {
          // Pick the previous neighbor
          newNeighbour[idx]--;
          maybeAddBucket(newNeighbour);
        } else if (rest > constants.BUCKET_WIDTH - neighbourThreshold) {
          // Pick the next neighbor
          newNeighbour[idx]++;
          maybeAddBucket(newNeighbour);
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
  traversedBuckets = traversedBuckets.concat(fallbackBuckets);

  for (const bucketAddress of traversedBuckets) {
    const bucket = cube.getOrCreateBucket(bucketAddress);

    if (bucket.type !== "null") {
      const priority = 0;
      bucketQueue.queue({ bucket, priority });
    }
  }
}
