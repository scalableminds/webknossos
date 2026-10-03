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

// Determines the buckets of the three orthogonal viewport planes with a flood fill: starting at
// the bucket the camera position lies in, it walks to neighbouring buckets and keeps only the
// ones whose box actually intersects one of the planes, using an exact SAT-style test. Unlike
// sampling the planes with scan lines, this can't leave holes for rotated planes, since a
// bucket can never "fall between" two samples.
//
// The per-bucket intersection test is on the hot path (it runs for every visited neighbour,
// up to 3 times each), so it's written as inlined scalar arithmetic on precomputed matrix
// coefficients rather than going through M4x4.transformVectorsAffine, which allocates a
// handful of arrays (input wrapper, flattened copy, output, re-chunked result) per call.

const ALPHA = Math.PI / 2;

// biome-ignore format: don't format array
export const ROTATIONS = {
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

const hashPosition = (x: number, y: number, z: number): number => 2 ** 32 * x + 2 ** 16 * y + z;

// Buckets are also picked that the plane would intersect if it moved by up to this fraction of
// a bucket's thickness along its normal, so that data is already loaded when the user moves
// along the view axis. Being < 1, this never reaches past the adjacent bucket layer,
// independent of zoom, mags and rotation.
export const PREFETCH_BUCKET_FRACTION = 0.3;

// Half of a bucket's thickness along the plane's normal, in local (plane) units.
// inverseQueryMatrix maps world to local coordinates, so its z row is the plane's normal.
function getBucketHalfThicknessInLocalZ(
  inverseQueryMatrix: Matrix4x4,
  bucketHalfSize: Vector3,
): number {
  return (
    bucketHalfSize[0] * Math.abs(inverseQueryMatrix[2]) +
    bucketHalfSize[1] * Math.abs(inverseQueryMatrix[6]) +
    bucketHalfSize[2] * Math.abs(inverseQueryMatrix[10])
  );
}

export default function determineBucketsForPlane(
  loadingStrategy: LoadingStrategy,
  denseMags: Array<Vector3>,
  position: Vector3,
  enqueueFunction: EnqueueFunction,
  matrix: Matrix4x4,
  logZoomStep: number,
  rects: PlaneRects,
  abortLimit?: number,
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
  prefetchBucketHalfSize: Vector3,
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
  // For prefetching, the slab is widened by PREFETCH_BUCKET_FRACTION of a (non-fallback)
  // bucket's thickness on each side, i.e. it also accepts the buckets the plane would intersect
  // after moving by up to that distance along its normal.
  const radiusLocalZ =
    getBucketHalfThicknessInLocalZ(m, bucketHalfSize) +
    2 * PREFETCH_BUCKET_FRACTION * getBucketHalfThicknessInLocalZ(m, prefetchBucketHalfSize);

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
  // The prefetch distance is based on the buckets of the rendered (non-fallback) mag, so that
  // fallback levels cover the same movement instead of a proportionally larger one.
  const nonFallbackBucketExtent = getBucketExtent(denseMags[nonFallbackLogZoomStep]);
  const prefetchBucketHalfSize: Vector3 = [
    nonFallbackBucketExtent[0] / 2,
    nonFallbackBucketExtent[1] / 2,
    nonFallbackBucketExtent[2] / 2,
  ];

  // A bucket only needs to be walked/enqueued once if it touches *any* of the three
  // orthogonal viewport planes, so a single flood fill covering all three is
  // roughly 3x cheaper than flood-filling each plane separately with its own
  // traversal and visited set.
  const intersectsPlaneTests = planeIds.map((planeId) =>
    buildIntersectsPlaneTest(planeId, matrix, rects, bucketHalfSize, prefetchBucketHalfSize),
  );
  const intersectsAnyPlane = (worldX: number, worldY: number, worldZ: number): boolean => {
    for (let i = 0; i < intersectsPlaneTests.length; i++) {
      if (intersectsPlaneTests[i](worldX, worldY, worldZ)) {
        return true;
      }
    }
    return false;
  };

  const visited = new Set<number>([hashPosition(seedAddress[0], seedAddress[1], seedAddress[2])]);
  const queue: Array<Vector3> = [seedAddress];

  // Tries a single face-neighbour (nx,ny,nz). Written as an explicitly-called function (see the
  // 6 call sites below) rather than a loop over NEIGHBOR_OFFSETS, to avoid destructuring an
  // offset tuple and indexing into an array on every one of the 6 slots tried per bucket.
  const tryNeighbor = (nx: number, ny: number, nz: number): void => {
    const neighborHash = hashPosition(nx, ny, nz);
    if (visited.has(neighborHash)) {
      return;
    }
    visited.add(neighborHash);

    const worldX = nx * voxelSize[0] + bucketHalfSize[0];
    const worldY = ny * voxelSize[1] + bucketHalfSize[1];
    const worldZ = nz * voxelSize[2] + bucketHalfSize[2];

    if (!intersectsAnyPlane(worldX, worldY, worldZ)) {
      return;
    }

    queue.push([nx, ny, nz]);
  };

  for (let head = 0; head < queue.length; head++) {
    const current = queue[head];
    const cx = current[0];
    const cy = current[1];
    const cz = current[2];

    const priority =
      Math.abs(cx - centerAddress[0]) +
      Math.abs(cy - centerAddress[1]) +
      Math.abs(cz - centerAddress[2]);
    enqueueFunction([cx, cy, cz, logZoomStep], priority + additionalPriorityWeight);

    const enqueuedBucketCount = head + 1;
    if (abortLimit != null && enqueuedBucketCount >= abortLimit) {
      return;
    }

    // The 6 face (Manhattan) neighbours of this bucket. A full 26-neighbourhood
    // would be way more expensive while not adding much value (due to the "prefetching"
    // feature, missing diagonal connections should become almost impossible).
    tryNeighbor(cx + 1, cy, cz);
    tryNeighbor(cx - 1, cy, cz);
    tryNeighbor(cx, cy + 1, cz);
    tryNeighbor(cx, cy - 1, cz);
    tryNeighbor(cx, cy, cz + 1);
    tryNeighbor(cx, cy, cz - 1);
  }
}
