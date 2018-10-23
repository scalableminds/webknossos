// @flow
import _ from "lodash";
import { getPosition } from "oxalis/model/accessors/flycam_accessor";
import {
  globalPositionToBucketPosition,
  globalPositionToBucketPositionFloat,
  bucketPositionToGlobalAddress,
  zoomedAddressToAnotherZoomStep,
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
import { initializeTMax } from "oxalis/model/bucket_data_handling/bucket_traversals";

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

  const centerPosition = getPosition(Store.getState().flycam);
  const centerBucket = globalPositionToBucketPosition(centerPosition, resolutions, logZoomStep);

  const transformToSphereCap = points =>
    M4x4.transformVectorsAffine(
      queryMatrix,
      points.map(vec => {
        V3.sub(vec, cameraVertex, vec);
        V3.scale(vec, sphericalCapRadius / V3.length(vec), vec);
        V3.add(vec, cameraVertex, vec);
        return vec;
      }),
    );

  // This array holds the four corners and the center point of the rendered plane
  const planePointsGlobal = transformToSphereCap([
    [-halfWidth, -halfWidth, 0], // 0 bottom left
    [halfWidth, -halfWidth, 0], // 1 bottom right
    [0, 0, 0],
    [-halfWidth, halfWidth, 0], // 3 top left
    [halfWidth, halfWidth, 0], // 4 top right
  ]);

  const planeEdgePointsGlobal = transformToSphereCap([
    [0, -halfWidth, 0], // 0 bottom
    [halfWidth, 0, 0], // 1 right
    [0, 0, 0],
    [-halfWidth, 0, 0], // 3 left
    [0, halfWidth, 0], // 4 top
  ]);

  const planeBuckets = planePointsGlobal.map((position: Vector3) =>
    globalPositionToBucketPosition(position, resolutions, logZoomStep),
  );
  const planeEdgeBuckets = planeEdgePointsGlobal.map((position: Vector3) =>
    globalPositionToBucketPosition(position, resolutions, logZoomStep),
  );

  let traversedBuckets = [];
  const transformPoint = vec => {
    V3.sub(vec, cameraVertex, vec);
    V3.scale(vec, sphericalCapRadius / V3.length(vec), vec);
    V3.add(vec, cameraVertex, vec);

    return M4x4.transformPointsAffine(queryMatrix, vec);
  };

  const cameraPosition = M4x4.transformVectorsAffine(queryMatrix, [cameraVertex])[0];
  const cameraBucket = globalPositionToBucketPosition(cameraPosition, resolutions, logZoomStep);
  const cameraDirection = V3.sub(centerPosition, cameraPosition);
  V3.scale(cameraDirection, 1 / Math.abs(V3.length(cameraDirection)), cameraDirection);

  const bucketLookUp = [];
  console.time("for each bucket");
  const maybeAddBucket = bucketPos => {
    const [x, y, z] = bucketPos;
    let lookup = null;
    /* eslint-disable */
    lookup = bucketLookUp[x] = bucketLookUp[x] || [];
    /* eslint-disable */
    lookup = lookup[y] = lookup[y] || [];

    if (!lookup[z]) {
      lookup[z] = true;
      traversedBuckets.push(bucketPos);
    }
  };
  const iterStep = 10;
  for (let y = -halfWidth; y <= halfWidth; y += iterStep) {
    const xOffset = y % iterStep;
    for (let x = -halfWidth - xOffset; x <= halfWidth + xOffset; x += iterStep) {
      for (let _z = 0; _z <= 1; _z++) {
        const z = _z;
        const transformedVec = transformPoint([x, y, z]);
        if (_z === 1) {
          V3.add(
            transformedVec,
            V3.scale(cameraDirection, 2 * 32 ** (logZoomStep + 1)),
            transformedVec,
          );
        }
        const bucketPos = globalPositionToBucketPositionFloat(
          transformedVec,
          resolutions,
          logZoomStep,
        );

        const flooredBucketPos = bucketPos.map(Math.floor);
        maybeAddBucket(flooredBucketPos);

        const neighbourThreshold = 3;
        bucketPos.forEach((pos, idx) => {
          const newNeighbour = flooredBucketPos.slice();
          const rest = (pos % 1) * 32;
          if (rest < neighbourThreshold) {
            // consider floor(pos) - 1
            newNeighbour[idx]--;
            maybeAddBucket(newNeighbour);
          } else if (rest > 32 - neighbourThreshold) {
            // consider floor(pos) + 1
            newNeighbour[idx]++;
            maybeAddBucket(newNeighbour);
          }
        });

        // maybeAddBucket(bucketPos.map(Math.round));

        // const step = cameraDirection.map(el => Math.sign(el));
        // let [tMaxX, tMaxY, tMaxZ] = initializeTMax([x, y, z], cameraDirection, step, [32, 32, 32]);
        // if (tMaxX <= tMaxY) {
        //   if (tMaxX <= tMaxZ) {
        //     // x
        //     maybeAddBucket([
        //       flooredBucketPos[0] + step[0],
        //       flooredBucketPos[1],
        //       flooredBucketPos[2],
        //       flooredBucketPos[3],
        //     ]);
        //   } else {
        //     // z
        //     maybeAddBucket([
        //       flooredBucketPos[0],
        //       flooredBucketPos[1],
        //       flooredBucketPos[2] + step[2],
        //       flooredBucketPos[3],
        //     ]);
        //   }
        // } else if (tMaxX >= tMaxY) {
        //   if (tMaxY <= tMaxZ) {
        //     // y
        //     maybeAddBucket([
        //       flooredBucketPos[0],
        //       flooredBucketPos[1] + step[1],
        //       flooredBucketPos[2],
        //       flooredBucketPos[3],
        //     ]);
        //   } else {
        //     // z
        //     maybeAddBucket([
        //       flooredBucketPos[0],
        //       flooredBucketPos[1],
        //       flooredBucketPos[2] + step[2],
        //       flooredBucketPos[3],
        //     ]);
        //   }
        // }
      }
    }
  }
  console.timeEnd("for each bucket");

  const cp = cameraPosition;
  // const topLeft = V3.sub(planeBucketsGlobal[2], cp);
  // const bottomLeft = V3.sub(planeBucketsGlobal[0], cp);
  // const topRight = V3.sub(planeBucketsGlobal[3], cp);
  // const bottomRight = V3.sub(planeBucketsGlobal[1], cp);

  const bottomEdgeToCam = V3.sub(planeEdgePointsGlobal[0], cp);
  const rightEdgeToCam = V3.sub(planeEdgePointsGlobal[1], cp);
  const leftEdgeToCam = V3.sub(planeEdgePointsGlobal[3], cp);
  const topEdgeToCam = V3.sub(planeEdgePointsGlobal[4], cp);

  // const isInFrustum = vec => {
  //   // const _tmp = [0, 0, 0];
  //   const a = V3.dot(V3.sub(vec, cp), left) >= 0;
  //   // const b = V3.dot(vec, right) <= 0;
  //   // const c = V3.dot(vec, top) <= 0;
  //   // const d = V3.dot(vec, bottom) <= 0;

  //   // console.log("a, b, c, d");

  //   return a; // && b; // && c && d;
  // };

  console.log("cameraBucket", cameraBucket);
  // const cameraDirection = M4x4.transformVectorsAffine(queryMatrix, [[0, 0, 1]])[0];

  const { scale } = Store.getState().dataset.dataSource;
  const matrixScale = getMatrixScale(scale);

  const inverseScale = V3.divide3([1, 1, 1], matrixScale);

  const aggregatePerDimension = (aggregateFn, buckets): Vector3 =>
    // $FlowFixMe
    [0, 1, 2].map(dim => aggregateFn(...buckets.map(pos => pos[dim])));

  const getBBox = buckets => ({
    cornerMin: aggregatePerDimension(Math.min, buckets),
    cornerMax: aggregatePerDimension(Math.max, buckets),
  });

  const boundingBoxBuckets = getBBox(planeBuckets); // .concat(planeEdgeBuckets));

  console.log("boundingBoxBuckets", boundingBoxBuckets);

  const isInViewDirection = bucketPosition => {
    // return x > cameraPosition[0] && y > cameraPosition[1] && z > cameraPosition[2];
    return V3.dot(cameraDirection, V3.sub(bucketPosition, cameraPosition)) >= 0;
  };

  const { zoomStep } = Store.getState().flycam;
  const squaredRadius = (zoomStep * sphericalCapRadius) ** 2;
  const tolerance = 1;
  let traversedBucketCount = 0;
  // let skippedFrustumCount = 0;
  const centerToCamera = V3.normalize(V3.sub(centerPosition, cameraPosition));

  const rightNormal = V3.normalize(V3.cross(topEdgeToCam, bottomEdgeToCam));
  const topNormal = V3.normalize(V3.cross(leftEdgeToCam, rightEdgeToCam));
  // U = V - N * dot(V, N)
  const project = (vec, normal) => V3.sub(vec, V3.scale(normal, V3.dot(vec, normal)));

  const calculateAngle = (vec, reference) => {
    const angle = Math.acos(V3.dot(V3.normalize(vec), V3.normalize(reference)));
    return angle;
  };
  const centerToCameraX = project(centerToCamera, rightNormal);
  const centerToCameraY = project(centerToCamera, topNormal);

  const getXYAngles = bucketAddress => {
    const vecToCamera = V3.sub(bucketAddress, cameraPosition);
    const projectedY = project(vecToCamera, rightNormal);
    const projectedX = project(vecToCamera, topNormal);

    const angleX = calculateAngle(projectedX, centerToCameraX);
    const angleY = calculateAngle(projectedY, centerToCameraY);
    return { angleX, angleY };
  };

  const getReferenceAngles = () => {
    const { angleX: tlAngleX, angleY: tlAngleY } = getXYAngles(planePointsGlobal[0]);
    const { angleX: brAngleX, angleY: brAngleY } = getXYAngles(planePointsGlobal[4]);

    const angleX = Math.abs(tlAngleX) > Math.abs(brAngleX) ? tlAngleX : brAngleX;
    const angleY = Math.abs(tlAngleY) > Math.abs(brAngleY) ? tlAngleY : brAngleY;

    const mapToMinMax = referenceAngle => {
      const lowAngle = Math.min(referenceAngle, -referenceAngle);
      const maxAngle = -lowAngle;
      return { lowAngle, maxAngle };
    };

    return {
      x: mapToMinMax(angleX),
      y: mapToMinMax(angleY),
    };
  };

  const referenceAngles = getReferenceAngles();

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

    const collisionTolerance = 0.01; // window.collisionTolerance != null ? window.collisionTolerance : 0.05;
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
    const middlePoint = [0, 1, 2].map(idx => (pos[idx] + nextPos[idx]) / 2);
    // const intersectsSide = side => {
    //   const aabbSigns = aabbPoints.map(vec => V3.dot(V3.sub(vec, cameraPosition), side) >= 0);
    //   return aabbSigns.some(b => b);
    // };

    // const isInFrustum = [
    //   // left,
    //   // right,
    //   // top, bottom
    // ].some(intersectsSide);
    // if (!isInFrustum) {
    //   skippedFrustumCount++;
    // }
    const isPosInViewAngle = _pos => {
      const { angleX, angleY } = getXYAngles(_pos);
      const isBetween = (angle, a, b) => angle >= a && angle <= b;
      const isInAngleRange = (angle, { lowAngle, maxAngle }) =>
        isBetween(angle, lowAngle, maxAngle);
      const isUndefined = isNaN(angleX) || isNaN(angleY);
      const isInAngle =
        isUndefined ||
        (isInAngleRange(angleX, referenceAngles.x) && isInAngleRange(angleY, referenceAngles.y));
      return isInAngle;
    };

    // const isSomePosInViewAngle = aabbPoints.some(isPosInViewAngle);
    // const isSomeInViewDirection = aabbPoints.some(isInViewDirection);
    const isSomePosInViewAngle = isPosInViewAngle(middlePoint);
    const isSomeInViewDirection = isInViewDirection(middlePoint);

    return (
      (doesIntersectSphere || window.ignoreIntersection) &&
      (isSomePosInViewAngle || window.ignoreInAngle) &&
      (isSomeInViewDirection || window.ignoreInDirection)
    );
  }

  const traverseBBox = () => {
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
          const vec = [x, y, z];
          const doesCollide = isBucketRelevant(vec);
          // && isInFrustum(vec);
          // && isInViewDirection(vec) || window.ignoreViewDirection)

          if (doesCollide) {
            traversedBuckets.push(vec);
          }
        }
      }
    }
  };

  const traverseFallbackBBox = () => {
    const fallbackBuckets = [];
    // use all fallback buckets in bbox
    const min = zoomedAddressToAnotherZoomStep(
      boundingBoxBuckets.cornerMin.concat(logZoomStep),
      resolutions,
      fallbackZoomStep,
    );
    const max = zoomedAddressToAnotherZoomStep(
      boundingBoxBuckets.cornerMax.concat(logZoomStep),
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

  // traverseBBox();

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
    console.log("bucketDiff.both", bucketDiff.both);
    console.log("bucketDiff.onlyA", bucketDiff.onlyA);
    console.log("bucketDiff.onlyB", bucketDiff.onlyB);

    bucketDiff.onlyA.forEach(bucketAddress => {
      const bucket = cube.getOrCreateBucket(unpackBucketId(bucketAddress));
      if (bucket.type !== "null") bucket.setVisualizationColor(0xff0000);
    });
    bucketDiff.both.forEach(bucketAddress => {
      const bucket = cube.getOrCreateBucket(unpackBucketId(bucketAddress));
      if (bucket.type !== "null") bucket.setVisualizationColor(0x00ff00);
    });

    const printWithAngle = (msg, arr, fmin, fmax) => {
      const vecsWithAngles = arr.map(vec => {
        const vecToCamera = V3.sub(vec, cameraPosition);
        return {
          angle: Math.acos(V3.dot(V3.normalize(vecToCamera), V3.normalize(centerToCamera))),
          vec,
        };
      });
      const angles = vecsWithAngles.map(x => x.angle);
      if (fmin != null && fmax != null) {
        const passingAngleCount = angles.filter(angle => !(angle > fmin && angle < fmax)).length;
        console.log(
          `Of ${angles.length} unnecessary buckets, ${passingAngleCount} could be trimmed`,
        );
      }
      const [min, max] = [_.min(angles), _.max(angles)];

      console.log(msg, "min", min, "max", max, vecsWithAngles);
      return [min, max];
    };

    const [min, max] = printWithAngle("bucketDiff.both", bucketDiff.both.map(unpackBucketId));
    printWithAngle("bucketDiff.onlyA", bucketDiff.onlyA.map(unpackBucketId), min, max);
    printWithAngle("bucketDiff.onlyB", bucketDiff.onlyB.map(unpackBucketId));

    const matchingRenderedBucketsA = bucketDiff.onlyA.map(unpackBucketId).map(address => {
      return {
        address,
        // matches: isInFrustum(address),
      };
    });

    const matchingRenderedBucketsB = bucketDiff.onlyB.map(unpackBucketId).map(address => {
      return {
        address,
        // matches: isInFrustum(address),
      };
    });
    console.log("bbox", boundingBoxBuckets);
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
  }

  // const fallbackBuckets = getFallbackBuckets(
  //   traversedBuckets,
  //   resolutions,
  //   fallbackZoomStep,
  //   isFallbackAvailable,
  // );

  const fallbackBuckets = isFallbackAvailable ? traverseFallbackBBox() : [];
  traversedBuckets = traversedBuckets.concat(fallbackBuckets);

  for (const bucketAddress of traversedBuckets) {
    const bucket = cube.getOrCreateBucket(bucketAddress);

    if (bucket.type !== "null") {
      const priority = 0;
      bucketQueue.queue({ bucket, priority });
    }
  }
}
