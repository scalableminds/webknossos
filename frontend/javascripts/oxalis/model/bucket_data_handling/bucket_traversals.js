// @flow
import { V3 } from "libs/mjs";
import type { Vector3 } from "oxalis/constants";
import {
  globalPositionToBucketPosition,
  getBucketExtent,
} from "oxalis/model/helpers/position_converter";

// Attention: Note that the implemented paper uses the term "voxel" for the unit
// we usually refer to as bucket. This is reflected in comments as well as variable naming.

// This module implements the algorithm presented in this paper:
// "A Fast Voxel Traversal Algorithm for Ray Tracing" (http://www.cse.yorku.ca/~amana/research/grid.pdf)
// The traverse function calculates the bucket positions which are traversed when building a ray
// from startPosition to endPosition, while considering buckets of a given zoomStep.

export default function traverse(
  startPosition: Vector3,
  endPosition: Vector3,
  resolutions: Array<Vector3>,
  zoomStep: number,
): Vector3[] {
  // The equation of the ray is →u + t→ v for t ≥ 0. The new traversal algorithm breaks down the ray into intervals of t,
  // each of which spans one voxel. We start at the ray origin and visit each of these voxels in interval order.
  const u = startPosition;
  const v = V3.sub(endPosition, startPosition);
  // The initialization phase begins by identifying the voxel in which the ray origin, → u, is found.
  const uBucket = globalPositionToBucketPosition(startPosition, resolutions, zoomStep);
  const lastBucket = globalPositionToBucketPosition(endPosition, resolutions, zoomStep);
  // The integer variables X and Y are initialized to the starting voxel coordinates.
  let [X, Y, Z] = uBucket;

  const voxelSize = getBucketExtent(resolutions, zoomStep);

  // In addition, the variables stepX and stepY are initialized to either 1 or -1 indicating whether X and Y are
  // incremented or decremented as the ray crosses voxel boundaries (this is determined by the sign of the x and y components of → v).
  const [stepX, stepY, stepZ] = v.map(el => Math.sign(el));
  const step = [stepX, stepY, stepZ];
  let [tMaxX, tMaxY, tMaxZ] = initializeTMax(u, v, [stepX, stepY, stepZ], voxelSize);

  // Finally, we compute tDeltaX and tDeltaY. TDeltaX indicates how far along the ray we must move (in units of t) for the horizontal component
  // of such a movement to equal the width of a voxel. Similarly, we store in tDeltaY the amount of movement along the ray which has a vertical component equal to the
  // height of a voxel.
  const [tDeltaX, tDeltaY, tDeltaZ] = [
    Math.abs(voxelSize[0] / v[0]),
    Math.abs(voxelSize[1] / v[1]),
    Math.abs(voxelSize[2] / v[2]),
  ];

  const intersectedBuckets = [[X, Y, Z]];

  const behindLastBucket = (dim, pos) => {
    if (step[dim] < 0) {
      return pos < lastBucket[dim];
    } else if (step[dim] > 0) {
      return pos > lastBucket[dim];
    } else {
      return false;
    }
  };

  // Helper functions for visiting a next bucket
  // Note: these functions mutate tMax[X|Y|Z] and intersectedBuckets
  const visitNextX = () => {
    const _X = X + stepX;
    tMaxX = tMaxX + tDeltaX;
    intersectedBuckets.push([_X, Y, Z]);
    return _X;
  };
  const visitNextY = () => {
    const _Y = Y + stepY;
    tMaxY = tMaxY + tDeltaY;
    intersectedBuckets.push([X, _Y, Z]);
    return _Y;
  };
  const visitNextZ = () => {
    const _Z = Z + stepZ;
    tMaxZ = tMaxZ + tDeltaZ;
    intersectedBuckets.push([X, Y, _Z]);
    return _Z;
  };

  // Helper functions for visiting the next two buckets
  const visitNextXY = () => {
    const [_X, _Y] = [visitNextX(), visitNextY()];
    intersectedBuckets.push([_X, _Y, Z]);
    return [_X, _Y];
  };
  const visitNextXZ = () => {
    const [_X, _Z] = [visitNextX(), visitNextZ()];
    intersectedBuckets.push([_X, Y, _Z]);
    return [_X, _Z];
  };
  const visitNextYZ = () => {
    const [_Y, _Z] = [visitNextY(), visitNextZ()];
    intersectedBuckets.push([X, _Y, _Z]);
    return [_Y, _Z];
  };

  // Helper function for visiting the next three buckets
  const visitNextXYZ = () => {
    const [_X, _Y, _Z] = [visitNextX(), visitNextY(), visitNextZ()];
    intersectedBuckets.push([_X, _Y, _Z]);
    return [_X, _Y, _Z];
  };

  // Since a small error in a while-loop can easily end in an endless loop,
  // this loop is limited to a maximum of 50 000 iterations.
  let loopProtection = 0;
  const maximumIterations = 50000;
  while (loopProtection++ < maximumIterations) {
    if (X === lastBucket[0] && Y === lastBucket[1] && Z === lastBucket[2]) {
      return intersectedBuckets;
    }

    if (behindLastBucket(0, X) || behindLastBucket(1, Y) || behindLastBucket(2, Z)) {
      // We didn't cross the lastBucket for some reason?
      return intersectedBuckets;
    }

    if (tMaxX < tMaxY) {
      if (tMaxX < tMaxZ) {
        X = visitNextX();
      } else if (tMaxX > tMaxZ) {
        Z = visitNextZ();
      } else {
        [X, Z] = visitNextXZ();
      }
    } else if (tMaxX > tMaxY) {
      if (tMaxY < tMaxZ) {
        Y = visitNextY();
      } else if (tMaxY > tMaxZ) {
        Z = visitNextZ();
      } else {
        [Y, Z] = visitNextYZ();
      }
    } else {
      // tMaxX === tMaxY
      /* eslint-disable-next-line no-lonely-if */
      if (tMaxZ < tMaxX) {
        Z = visitNextZ();
      } else if (tMaxZ > tMaxX) {
        [X, Y] = visitNextXY();
      } else {
        // tMaxX === tMaxY === tMaxZ
        [X, Y, Z] = visitNextXYZ();
      }
    }
  }

  throw new Error("Didn't reach target voxel?");
}

function initializeTMax(
  u: Vector3,
  v: Vector3,
  step: Vector3,
  voxelSize: Vector3,
): [number, number, number] {
  // Next, we determine the value of t at which the ray crosses the first vertical voxel boundary and store it
  // in variable tMaxX.
  // We perform a similar computation in y and store the result in tMaxY.
  // The minimum of these two values will indicate how much we can travel along the ray and still remain in the current voxel.

  const positiveRest = [u[0] % voxelSize[0], u[1] % voxelSize[1], u[2] % voxelSize[2]];
  const negativeRest = [
    voxelSize[0] - (u[0] % voxelSize[0]),
    voxelSize[1] - (u[1] % voxelSize[1]),
    voxelSize[2] - (u[2] % voxelSize[2]),
  ];

  // $FlowIssue[invalid-tuple-arity] Flow does not understand that mapping a tuple returns a tuple
  return [
    Math.abs((step[0] > 0 ? negativeRest[0] : positiveRest[0]) / v[0]),
    Math.abs((step[1] > 0 ? negativeRest[1] : positiveRest[1]) / v[1]),
    Math.abs((step[2] > 0 ? negativeRest[2] : positiveRest[2]) / v[2]),
  ].map(el => (Number.isNaN(el) ? Infinity : el));
}
