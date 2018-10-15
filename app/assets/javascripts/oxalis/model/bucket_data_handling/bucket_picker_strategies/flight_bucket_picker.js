// @flow
import { getPosition } from "oxalis/model/accessors/flycam_accessor";
import {
  globalPositionToBucketPosition,
  bucketPositionToGlobalAddress,
} from "oxalis/model/helpers/position_converter";
import type { Vector3 } from "oxalis/constants";
import type { Matrix4x4 } from "libs/mjs";
import PriorityQueue from "js-priority-queue";
import * as Utils from "libs/utils";
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

  const width = constants.VIEWPORT_WIDTH;
  const halfWidth = width / 2;

  const { sphericalCapRadius } = Store.getState().userConfiguration;
  const cameraVertex = [0, 0, -sphericalCapRadius];
  const resolutions = getResolutions(Store.getState().dataset);

  const centerAddress = globalPositionToBucketPosition(
    getPosition(Store.getState().flycam),
    resolutions,
    logZoomStep,
  );

  // This array holds the four corners and the center point of the rendered plane
  const planePointsGlobal = M4x4.transformVectorsAffine(
    queryMatrix,
    [
      [-halfWidth, -halfWidth, 0], // 0 bottom left
      [halfWidth, -halfWidth, 0], // 1 bottom right
      [0, 0, 0],
      [-halfWidth, halfWidth, 0], // 2 top left
      [halfWidth, halfWidth, 0], // 3 top right
    ].map(vec => {
      V3.sub(vec, cameraVertex, vec);
      V3.scale(vec, sphericalCapRadius / V3.length(vec), vec);
      V3.add(vec, cameraVertex, vec);
      return vec;
    }),
  );
  const planePoints = planePointsGlobal.map((position: Vector3) =>
    globalPositionToBucketPosition(position, resolutions, logZoomStep),
  );

  const cameraPosition = M4x4.transformVectorsAffine(queryMatrix, [cameraVertex])[0];
  const cameraBucketPosition = globalPositionToBucketPosition(
    cameraPosition,
    resolutions,
    logZoomStep,
  );

  const cp = cameraPosition;
  const topLeft = V3.sub(planePointsGlobal[2], cp);
  const bottomLeft = V3.sub(planePointsGlobal[0], cp);
  const topRight = V3.sub(planePointsGlobal[3], cp);
  const bottomRight = V3.sub(planePointsGlobal[1], cp);

  const left = V3.cross(topLeft, bottomLeft);
  const right = V3.cross(bottomRight, topRight);
  const top = V3.cross(topLeft, topRight);
  const bottom = V3.cross(bottomRight, bottomLeft);
  const isInFrustum = vec => {
    // const _tmp = [0, 0, 0];
    const a = V3.dot(V3.sub(vec, cp), left) >= 0;
    // const b = V3.dot(vec, right) <= 0;
    // const c = V3.dot(vec, top) <= 0;
    // const d = V3.dot(vec, bottom) <= 0;

    // console.log("a, b, c, d");

    return a; // && b; // && c && d;
  };

  console.log("cameraBucketPosition", cameraBucketPosition);
  const cameraDirection = M4x4.transformVectorsAffine(queryMatrix, [[0, 0, 1]])[0];
  // V3.scale(cameraDirection, 1 / V3.length(cameraDirection), cameraDirection);

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

  // const isInViewDirection = ([x, y, z]) => {
  //   // return x > cameraPosition[0] && y > cameraPosition[1] && z > cameraPosition[2];
  //   return V3.dot(cameraDirection, V3.sub([x, y, z], cameraBucketPosition)) < 0;
  // };

  const { zoomStep } = Store.getState().flycam;
  const squaredRadius = (zoomStep * sphericalCapRadius) ** 2;
  const tolerance = 1;
  let traversedBucketCount = 0;
  let skippedFrustumCount = 0;

  function isBucketRelevant([x, y, z]) {
    const pos = bucketPositionToGlobalAddress([x, y, z, logZoomStep], resolutions);
    const nextPos = bucketPositionToGlobalAddress([x + 1, y + 1, z + 1, logZoomStep], resolutions);

    const closest = [0, 1, 2].map(dim => Utils.clamp(pos[dim], cameraPosition[dim], nextPos[dim]));

    const farthest = [0, 1, 2].map(
      dim =>
        Math.abs(pos[dim] - cameraPosition[dim]) > Math.abs(nextPos[dim] - cameraPosition[dim])
          ? pos[dim]
          : nextPos[dim],
    );

    const closestDist = V3.scaledSquaredDist(cameraPosition, closest, inverseScale);
    const farthestDist = V3.scaledSquaredDist(cameraPosition, farthest, inverseScale);

    const collisionTolerance = 1; // window.collisionTolerance != null ? window.collisionTolerance : 0.05;
    const doesIntersectSphere =
      (1 - collisionTolerance) * closestDist < squaredRadius &&
      (1 + collisionTolerance) * farthestDist > squaredRadius;

    const aabbPoints = [
      [pos[0], pos[1], pos[2]],
      [pos[0], pos[1], nextPos[2]],
      [pos[0], nextPos[1], pos[2]],
      [pos[0], nextPos[1], nextPos[2]],
      [nextPos[0], pos[1], pos[2]],
      [nextPos[0], pos[1], nextPos[2]],
      [nextPos[0], nextPos[1], pos[2]],
      [nextPos[0], nextPos[1], nextPos[2]],
    ];

    const intersectsSide = side => {
      const aabbSigns = aabbPoints.map(vec => V3.dot(V3.sub(vec, cameraPosition), side) >= 0);
      return aabbSigns.some(b => b);
    };

    const isInFrustum = [
      // left,
      right,
      // top, bottom
    ].some(intersectsSide);
    if (!isInFrustum) {
      skippedFrustumCount++;
    }

    return doesIntersectSphere && isInFrustum;
  }

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
        traversedBucketCount++;
        const doesCollide = isBucketRelevant([x, y, z]); // && isInFrustum([x, y, z]);

        // && isInViewDirection([x, y, z]) || window.ignoreViewDirection)

        if (doesCollide) {
          // if (!) {
          //   wrongSideCollisionCount++;
          // }
          traversedBuckets.push([x, y, z]);
          if (window.lastRenderedBuckset != null) {
            if (!window.lastRenderedBuckset.has([x, y, z, logZoomStep].join(","))) {
              // console.log(
              //   "selected for gpu, but not used in most recent call",
              //   [x, y, z],
              //   "dist: ",
              //   closestDist,
              //   farthestDist,
              // );
            }
          }
        }
      }
    }
  }

  console.log("skippedFrustumCount", skippedFrustumCount);

  traversedBuckets = traversedBuckets.map(addr => [...addr, logZoomStep]);
  function isInBBox(bucket) {
    return bucket
      .slice(0, 3)
      .every(
        (el, idx) =>
          el >= boundingBoxBuckets.cornerMin[idx] - tolerance &&
          el <= boundingBoxBuckets.cornerMax[idx] + tolerance,
      );
  }
  const makeBucketId = ([x, y, z]) => [x, y, z, logZoomStep].join(",");
  const unpackBucketId = str =>
    str
      .split(",")
      .map(el => parseInt(el))
      .map((el, idx) => (idx < 3 ? el : 0));

  if (window.useRenderedBucketsInNextFrame) {
    const lastRenderedBuckets = Array.from(window.lastRenderedBuckset);
    const bucketDiff = Utils.diffArrays(traversedBuckets.map(makeBucketId), lastRenderedBuckets);
    console.log("bucketDiff", bucketDiff);
    console.log("bucketDiff", bucketDiff.onlyA);
    console.log("bucketDiff", bucketDiff.onlyB);

    const matchingRenderedBucketsA = bucketDiff.onlyA.map(unpackBucketId).map(address => {
      return {
        address,
        // matches: isInFrustum(address),
      };
    });

    console.log("matchingRenderedBucketsA", matchingRenderedBucketsA);

    const matchingRenderedBucketsB = bucketDiff.onlyB.map(unpackBucketId).map(address => {
      return {
        address,
        // matches: isInFrustum(address),
      };
    });

    console.log("matchingRenderedBucketsB", matchingRenderedBucketsB);

    // const actuallyNeededBuckets = Array.from(window.lastRenderedBuckset).map(unpackBucketId);
    // // window.useRenderedBucketsInNextFrame = false;

    // const filteredActuallyNeeded = actuallyNeededBuckets.filter(b => isBucketRelevant(b));
    // console.log("actuallyNeededBuckets", actuallyNeededBuckets);
    // console.log("needed buckets which match our criteria", filteredActuallyNeeded.length);
    // console.log(
    //   "needed buckets which dont match our criteria",
    //   actuallyNeededBuckets.length - filteredActuallyNeeded.length,
    // );

    // console.log("testing whether relevant buckets are in defined bbox");
    console.log("bbox", boundingBoxBuckets);

    // const neededInBBox = actuallyNeededBuckets.filter(b => isInBBox(b));
    // console.log("needed buckets which are in bbox", neededInBBox.length);

    // traversedBuckets = actuallyNeededBuckets;
  }

  window.lastUsedFlightBuckets = traversedBuckets;

  const traversedBucketIds = traversedBuckets.map(makeBucketId);
  const traversedBucketSet = new Set(traversedBucketIds);

  if (window.lastRenderedBuckset != null) {
    const unusedBuckets = traversedBucketIds.filter(b => !window.lastRenderedBuckset.has(b));
    const missingBuckets = Array.from(window.lastRenderedBuckset).filter(
      b => !traversedBucketSet.has(b),
    );
    console.log("buckets are passed to the GPU", traversedBucketIds.length);
    console.log("buckets were missing", missingBuckets.length, missingBuckets);
    console.log("were not used for rendering", unusedBuckets.length);
    console.log("traversedBucketCount", traversedBucketCount);
    // console.log("wrongSideCollisionCount", wrongSideCollisionCount);

    if (window.onlyTransferRenderedBuckets) {
      const filteredBuckets = traversedBuckets.filter(coords =>
        window.lastRenderedBuckset.has(makeBucketId(coords)),
      );
      traversedBuckets = filteredBuckets;
    } else if (window.onlyTransferUnusedBuckets) {
      const filteredBuckets = traversedBuckets.filter(
        coords => !window.lastRenderedBuckset.has(makeBucketId(coords)),
      );
      traversedBuckets = filteredBuckets;
    } else if (window.onlyTransferMissingBuckets) {
      // todo
    }
  }

  // const fallbackBuckets = getFallbackBuckets(
  //   traversedBuckets,
  //   resolutions,
  //   fallbackZoomStep,
  //   isFallbackAvailable,
  // );

  // traversedBuckets = traversedBuckets.concat(fallbackBuckets);

  for (const bucketAddress of traversedBuckets) {
    const bucket = cube.getOrCreateBucket(bucketAddress);

    if (bucket.type !== "null") {
      const priority = V3.sub(bucketAddress, centerAddress).reduce((a, b) => a + Math.abs(b), 0);
      bucketQueue.queue({ bucket, priority });
    }
  }
}
