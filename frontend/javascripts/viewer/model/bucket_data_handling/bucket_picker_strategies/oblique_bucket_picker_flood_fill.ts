import { M4x4 } from "libs/mjs";
import type { Matrix4x4 } from "mjs";
import type { OrthoViewWithoutTD, Vector3 } from "viewer/constants";
import type { EnqueueFunction } from "viewer/model/bucket_data_handling/layer_rendering_manager";
import {
  getBucketExtent,
  globalPositionToBucketPosition,
} from "viewer/model/helpers/position_converter";
import type { LoadingStrategy, PlaneRects } from "viewer/store";
import { getPriorityWeightForZoomStepDiff, MAX_ZOOM_STEP_DIFF } from "../loading_strategy_logic";
import type { ScanLineCallback } from "./oblique_bucket_picker";

// This module is an alternative to oblique_bucket_picker.ts. Instead of approximating the
// plane's bucket coverage with a set of sampled scan lines (which can leave gaps for
// obliquely rotated planes, since a fixed line density can under-sample the plane at some
// rotation angles), it enumerates buckets with a flood fill: starting at the bucket the
// camera position lies in, it walks to neighbouring buckets and keeps only the ones whose
// box actually intersects one of the three orthogonal viewport planes, using an exact
// SAT-style test. This guarantees completeness by construction -- a bucket can never "fall
// between" two samples -- at the cost of a graph traversal instead of a handful of line
// traversals.
//
// The per-bucket intersection test is on the hot path (it runs for every visited neighbour,
// up to 3 times each), so it's written as inlined scalar arithmetic on precomputed matrix
// coefficients rather than going through M4x4.transformVectorsAffine, which allocates a
// handful of arrays (input wrapper, flattened copy, output, re-chunked result) per call.

const ALPHA = Math.PI / 2;

// biome-ignore format: don't format array
const ROTATIONS = {
  YZ: [
    Math.cos(ALPHA), 0, Math.sin(ALPHA), 0,
    0, 1, 0, 0,
    -Math.sin(ALPHA), 0, Math.cos(ALPHA), 0,
    0, 0, 0, 1,
  ] as Matrix4x4,
  XZ: [
    1, 0, 0, 0,
    0, Math.cos(ALPHA), Math.sin(ALPHA), 0,
    0, -Math.sin(ALPHA), Math.cos(ALPHA), 0,
    0, 0, 0, 1,
  ] as Matrix4x4,
};

const hashPosition = ([x, y, z]: Vector3): number => 2 ** 32 * x + 2 ** 16 * y + z;

// The 6 face (Manhattan) neighbours of a bucket in the 3D bucket grid. Cheaper than the full
// 26-neighbourhood (3x less branching per visited bucket), at the cost of relying on the
// three orthogonal plane sheets (tested together below) to cover any single sheet's
// diagonal-only connections -- a lone, steeply tilted plane is only guaranteed to be
// 26-connected, not 6-connected, the same way a digital line is only guaranteed to be
// 8-connected in 2D, not 4-connected.
const NEIGHBOR_OFFSETS: Array<Vector3> = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];

export default function determineBucketsForPlane(
  loadingStrategy: LoadingStrategy,
  denseMags: Array<Vector3>,
  position: Vector3,
  enqueueFunction: EnqueueFunction,
  matrix: Matrix4x4,
  logZoomStep: number,
  rects: PlaneRects,
  abortLimit?: number,
  onScanLine?: ScanLineCallback,
): void {
  let zoomStepDiff = 0;

  while (logZoomStep + zoomStepDiff < denseMags.length && zoomStepDiff <= MAX_ZOOM_STEP_DIFF) {
    addNecessaryBucketsToPriorityQueuePlane(
      loadingStrategy,
      denseMags,
      position,
      enqueueFunction,
      matrix,
      logZoomStep,
      zoomStepDiff,
      rects,
      abortLimit,
      onScanLine,
    );
    zoomStepDiff++;
  }
}

// Takes a bucket's *world-space center* (computed once per candidate, not once per plane, see
// below) and returns whether it's within one of the three orthogonal viewport planes.
type IntersectsPlaneTest = (worldX: number, worldY: number, worldZ: number) => boolean;

// Builds an exact box-vs-rect intersection test for one of the three orthogonal viewport
// planes (SAT-style, see module comment above). Everything here only depends on the plane's
// orientation/extent (not on any particular bucket), so it's computed once per planeId and
// then reused, as plain scalar coefficients, for every bucket that gets tested against it.
function buildIntersectsPlaneTest(
  planeId: OrthoViewWithoutTD,
  matrix: Matrix4x4,
  rects: PlaneRects,
  bucketHalfSize: Vector3,
): IntersectsPlaneTest {
  const queryMatrix = [...matrix] as Matrix4x4;

  if (planeId === "PLANE_YZ") {
    M4x4.mul(matrix, ROTATIONS.YZ, queryMatrix);
  } else if (planeId === "PLANE_XZ") {
    M4x4.mul(matrix, ROTATIONS.XZ, queryMatrix);
  }

  const enlargedHalfExtentX = Math.ceil(rects[planeId].width / 2);
  const enlargedHalfExtentY = Math.ceil(rects[planeId].height / 2);

  // mjs matrices are column-major (m[4*col + row]), so e.g. local.z = m[2]*worldX +
  // m[6]*worldY + m[10]*worldZ + m[14] (see M4x4.transformPointsAffine in libs/mjs.ts, which
  // this inlines for a single point instead of an arbitrary array of points).
  const m = M4x4.inverse(queryMatrix);
  const xx = m[0];
  const xy = m[4];
  const xz = m[8];
  const xt = m[12];
  const yx = m[1];
  const yy = m[5];
  const yz = m[9];
  const yt = m[13];
  const zx = m[2];
  const zy = m[6];
  const zz = m[10];
  const zt = m[14];

  // The maximum extent (radius) of a bucket's box along a local axis, after the transform.
  const radiusLocalX =
    bucketHalfSize[0] * Math.abs(xx) +
    bucketHalfSize[1] * Math.abs(xy) +
    bucketHalfSize[2] * Math.abs(xz);
  const radiusLocalY =
    bucketHalfSize[0] * Math.abs(yx) +
    bucketHalfSize[1] * Math.abs(yy) +
    bucketHalfSize[2] * Math.abs(yz);
  const radiusLocalZ =
    bucketHalfSize[0] * Math.abs(zx) +
    bucketHalfSize[1] * Math.abs(zy) +
    bucketHalfSize[2] * Math.abs(zz);

  return (worldX: number, worldY: number, worldZ: number): boolean => {
    // Local z (the plane's thickness axis) is checked first, as it's usually the cheapest
    // way to reject a bucket that isn't near this particular plane at all.
    const localZ = zx * worldX + zy * worldY + zz * worldZ + zt;
    if (Math.abs(localZ) > radiusLocalZ) {
      return false;
    }
    const localX = xx * worldX + xy * worldY + xz * worldZ + xt;
    if (Math.abs(localX) > enlargedHalfExtentX + radiusLocalX) {
      return false;
    }
    const localY = yx * worldX + yy * worldY + yz * worldZ + yt;
    return Math.abs(localY) <= enlargedHalfExtentY + radiusLocalY;
  };
}

function addNecessaryBucketsToPriorityQueuePlane(
  loadingStrategy: LoadingStrategy,
  denseMags: Array<Vector3>,
  position: Vector3,
  enqueueFunction: EnqueueFunction,
  matrix: Matrix4x4,
  nonFallbackLogZoomStep: number,
  zoomStepDiff: number,
  rects: PlaneRects,
  abortLimit?: number,
  onScanLine?: ScanLineCallback,
): void {
  const logZoomStep = nonFallbackLogZoomStep + zoomStepDiff;
  const planeIds: Array<OrthoViewWithoutTD> = ["PLANE_XY", "PLANE_XZ", "PLANE_YZ"];

  // null is passed as additionalCoordinates, since the bucket picker doesn't care about the
  // additional coordinates. It simply sticks to 3D and the caller is responsible for augmenting
  // potential other coordinates.
  const centerAddress = globalPositionToBucketPosition(position, denseMags, logZoomStep, null);
  const seedAddress: Vector3 = [centerAddress[0], centerAddress[1], centerAddress[2]];
  const additionalPriorityWeight = getPriorityWeightForZoomStepDiff(loadingStrategy, zoomStepDiff);
  const voxelSize = getBucketExtent(denseMags[logZoomStep]);
  const bucketHalfSize: Vector3 = [voxelSize[0] / 2, voxelSize[1] / 2, voxelSize[2] / 2];

  // A bucket only needs to be walked/enqueued once if it touches *any* of the three
  // orthogonal viewport planes, so a single flood fill covering all three -- short-circuiting
  // as soon as one of the three tests matches -- is both correct (their sheets are connected
  // through the shared seed bucket) and roughly 3x cheaper than flood-filling each plane
  // separately with its own traversal and visited set.
  const intersectsPlaneTests = planeIds.map((planeId) =>
    buildIntersectsPlaneTest(planeId, matrix, rects, bucketHalfSize),
  );
  // The bucket's world-space center is computed once per candidate (not once per plane test,
  // which would triple the redundant arithmetic for no reason -- all three tests operate on
  // the same world point).
  const intersectsAnyPlane = (worldX: number, worldY: number, worldZ: number): boolean => {
    for (let i = 0; i < intersectsPlaneTests.length; i++) {
      if (intersectsPlaneTests[i](worldX, worldY, worldZ)) {
        return true;
      }
    }
    return false;
  };

  // The seed bucket is trusted unconditionally (the camera position it's derived from lies on
  // all three planes by construction); only its neighbours are filtered by intersectsAnyPlane.
  const visited = new Set<number>([hashPosition(seedAddress)]);
  const queue: Array<Vector3> = [seedAddress];

  for (let head = 0; head < queue.length; head++) {
    const current = queue[head];

    const priority =
      Math.abs(current[0] - centerAddress[0]) +
      Math.abs(current[1] - centerAddress[1]) +
      Math.abs(current[2] - centerAddress[2]);
    enqueueFunction(
      [current[0], current[1], current[2], logZoomStep],
      priority + additionalPriorityWeight,
    );

    if (abortLimit != null && visited.size > abortLimit) {
      return;
    }

    for (const [dx, dy, dz] of NEIGHBOR_OFFSETS) {
      const neighbor: Vector3 = [current[0] + dx, current[1] + dy, current[2] + dz];
      const neighborHash = hashPosition(neighbor);

      if (visited.has(neighborHash)) {
        continue;
      }
      visited.add(neighborHash);

      const worldX = neighbor[0] * voxelSize[0] + bucketHalfSize[0];
      const worldY = neighbor[1] * voxelSize[1] + bucketHalfSize[1];
      const worldZ = neighbor[2] * voxelSize[2] + bucketHalfSize[2];

      if (intersectsAnyPlane(worldX, worldY, worldZ)) {
        if (onScanLine != null) {
          // Visualizes the flood fill's traversal edges, reusing the same debug-line
          // plumbing that oblique_bucket_picker.ts uses for its scan lines. Guarded by an
          // explicit null check (instead of `onScanLine?.(...)`) so the two Vector3 array
          // allocations below are skipped entirely outside of debugging.
          const currentCenter: Vector3 = [
            current[0] * voxelSize[0] + bucketHalfSize[0],
            current[1] * voxelSize[1] + bucketHalfSize[1],
            current[2] * voxelSize[2] + bucketHalfSize[2],
          ];
          onScanLine(currentCenter, [worldX, worldY, worldZ]);
        }
        queue.push(neighbor);
      }
    }
  }
}
