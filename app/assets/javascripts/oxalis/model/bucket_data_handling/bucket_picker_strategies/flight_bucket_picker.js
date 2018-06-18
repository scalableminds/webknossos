// @flow
import { getPosition } from "oxalis/model/accessors/flycam_accessor";
import {
  globalPositionToBucketPosition,
  bucketPositionToGlobalAddress,
} from "oxalis/model/helpers/position_converter";
import type { Vector3 } from "oxalis/constants";
import type { Matrix4x4 } from "libs/mjs";
import PriorityQueue from "js-priority-queue";
import Utils from "libs/utils";
import { M4x4, V3 } from "libs/mjs";
import { getMatrixScale } from "oxalis/model/reducers/flycam_reducer";
import constants from "oxalis/constants";
import Store from "oxalis/store";
import { getResolutions } from "oxalis/model/accessors/dataset_accessor";
import type DataCube from "oxalis/model/bucket_data_handling/data_cube";
import { getFallbackBuckets } from "./oblique_bucket_picker";

export default function determineBucketsForFlight(
  cube: DataCube,
  bucketQueue: PriorityQueue,
  matrix: Matrix4x4,
  logZoomStep: number,
  fallbackZoomStep: number,
  isFallbackAvailable: boolean,
): void {
  const queryMatrix = M4x4.scale1(1, matrix);

  const enlargementFactor = 1.0;
  const enlargedExtent = constants.VIEWPORT_WIDTH * enlargementFactor;
  const enlargedHalfExtent = enlargedExtent / 2;

  const { sphericalCapRadius } = Store.getState().userConfiguration;
  const cameraVertex = [0, 0, -sphericalCapRadius];
  const resolutions = getResolutions(Store.getState().dataset);

  // This array holds the four corners and the center point of the rendered plane
  const planePoints = M4x4.transformVectorsAffine(
    queryMatrix,
    [
      [-enlargedHalfExtent, -enlargedHalfExtent, 0],
      [enlargedHalfExtent, -enlargedHalfExtent, 0],
      [0, 0, 0],
      [-enlargedHalfExtent, enlargedHalfExtent, 0],
      [enlargedHalfExtent, enlargedHalfExtent, 0],
    ].map(vec => {
      V3.sub(vec, cameraVertex, vec);
      V3.scale(vec, sphericalCapRadius / V3.length(vec), vec);
      V3.add(vec, cameraVertex, vec);
      return vec;
    }),
  ).map((position: Vector3) => globalPositionToBucketPosition(position, resolutions, logZoomStep));

  const cameraPosition = M4x4.transformVectorsAffine(queryMatrix, [cameraVertex])[0];

  const { scale } = Store.getState().dataset.dataSource;
  const matrixScale = getMatrixScale(scale);

  const inverseScale = V3.divide3([1, 1, 1], matrixScale);

  const aggregatePerDimension = aggregateFn =>
    [0, 1, 2].map(dim => aggregateFn(...planePoints.map(pos => pos[dim])));

  const boundingBoxBuckets = {
    cornerMin: aggregatePerDimension(Math.min),
    cornerMax: aggregatePerDimension(Math.max),
  };

  let traversedBuckets = [];

  const { zoomStep } = Store.getState().flycam;
  const squaredRadius = (zoomStep * sphericalCapRadius) ** 2;
  const tolerance = 1;

  // iterate over all buckets within bounding box
  for (
    let x = boundingBoxBuckets.cornerMin[0] - tolerance;
    x <= boundingBoxBuckets.cornerMax[0] + tolerance;
    x++
  ) {
    for (
      let y = boundingBoxBuckets.cornerMin[1] - tolerance;
      y <= boundingBoxBuckets.cornerMax[1] + tolerance;
      y++
    ) {
      for (
        let z = boundingBoxBuckets.cornerMin[2] - tolerance;
        z <= boundingBoxBuckets.cornerMax[2] + tolerance;
        z++
      ) {
        const pos = bucketPositionToGlobalAddress([x, y, z, logZoomStep], resolutions);
        const nextPos = bucketPositionToGlobalAddress(
          [x + 1, y + 1, z + 1, logZoomStep],
          resolutions,
        );

        const closest = [0, 1, 2].map(dim =>
          Utils.clamp(pos[dim], cameraPosition[dim], nextPos[dim]),
        );

        const farthest = [0, 1, 2].map(
          dim =>
            Math.abs(pos[dim] - cameraPosition[dim]) > Math.abs(nextPos[dim] - cameraPosition[dim])
              ? pos[dim]
              : nextPos[dim],
        );

        const closestDist = V3.scaledSquaredDist(cameraPosition, closest, inverseScale);
        const farthestDist = V3.scaledSquaredDist(cameraPosition, farthest, inverseScale);

        const collisionTolerance = 0.05;
        const doesCollide =
          (1 - collisionTolerance) * closestDist <= squaredRadius &&
          (1 + collisionTolerance) * farthestDist >= squaredRadius;

        if (doesCollide) {
          traversedBuckets.push([x, y, z]);
        }
      }
    }
  }

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
