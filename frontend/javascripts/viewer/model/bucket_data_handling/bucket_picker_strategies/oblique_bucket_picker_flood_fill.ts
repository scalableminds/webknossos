import { M4x4, V3 } from "libs/mjs";
import type { Matrix4x4 } from "mjs";
import type { OrthoViewWithoutTD, Vector2, Vector3 } from "viewer/constants";
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
// box actually intersects the (finite) plane rectangle, using an exact SAT-style test. This
// guarantees completeness by construction -- a bucket can never "fall between" two samples --
// at the cost of a graph traversal instead of a handful of line traversals.

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

// All 26 neighbours of a bucket in the 3D bucket grid (6 face + 12 edge + 8 corner
// neighbours). A continuous plane intersecting a regular grid is only guaranteed to be
// 26-connected, not 6-connected -- the same way a digital line is only guaranteed to be
// 8-connected in 2D, not 4-connected. Restricting the flood fill to face neighbours can
// make it terminate early across a diagonal-only connection, reproducing exactly the kind
// of holes this picker exists to avoid.
const NEIGHBOR_OFFSETS: Array<Vector3> = [];
for (let dx = -1; dx <= 1; dx++) {
  for (let dy = -1; dy <= 1; dy++) {
    for (let dz = -1; dz <= 1; dz++) {
      if (dx !== 0 || dy !== 0 || dz !== 0) {
        NEIGHBOR_OFFSETS.push([dx, dy, dz]);
      }
    }
  }
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
  // Dedupes buckets across planeIds (a bucket can be found by more than one plane's flood
  // fill), so it's only ever enqueued once. This is intentionally separate from the
  // per-plane `visited` set below, which tracks graph traversal, not enqueue-dedup: a bucket
  // already claimed by an earlier planeId must still be walked through by a later planeId's
  // flood fill, or that flood fill could lose connectivity to buckets only reachable through it.
  const enqueuedBucketHashes = new Set<number>();

  // null is passed as additionalCoordinates, since the bucket picker doesn't care about the
  // additional coordinates. It simply sticks to 3D and the caller is responsible for augmenting
  // potential other coordinates.
  const centerAddress = globalPositionToBucketPosition(position, denseMags, logZoomStep, null);
  const seedAddress: Vector3 = [centerAddress[0], centerAddress[1], centerAddress[2]];
  const additionalPriorityWeight = getPriorityWeightForZoomStepDiff(loadingStrategy, zoomStepDiff);
  const voxelSize = getBucketExtent(denseMags[logZoomStep]);
  const bucketHalfSize: Vector3 = [voxelSize[0] / 2, voxelSize[1] / 2, voxelSize[2] / 2];

  for (const planeId of planeIds) {
    const queryMatrix = [...matrix] as Matrix4x4;

    const extent: Vector2 = [rects[planeId].width, rects[planeId].height];
    const enlargedHalfExtent: Vector2 = [
      Math.ceil(extent[0] / 2),
      Math.ceil(extent[1] / 2),
    ] as Vector2;
    if (planeId === "PLANE_YZ") {
      M4x4.mul(matrix, ROTATIONS.YZ, queryMatrix);
    } else if (planeId === "PLANE_XZ") {
      M4x4.mul(matrix, ROTATIONS.XZ, queryMatrix);
    }

    const inverseMatrix = M4x4.inverse(queryMatrix);

    // Precompute how a unit step along each *world* axis moves the local (plane-relative)
    // coordinates. This bounds, for any axis-aligned bucket box, exactly how far its
    // footprint can extend along each local axis after the transform -- a standard
    // SAT-style (separating axis theorem) box-vs-plane / box-vs-rect test.
    const [localOrigin, localUnitX, localUnitY, localUnitZ] = M4x4.transformVectorsAffine(
      inverseMatrix,
      [
        [0, 0, 0],
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 1],
      ],
    );
    const dLocalDWorldX = V3.sub(localUnitX, localOrigin);
    const dLocalDWorldY = V3.sub(localUnitY, localOrigin);
    const dLocalDWorldZ = V3.sub(localUnitZ, localOrigin);

    // The maximum extent (radius) of a bucket's box along a local axis, after the transform.
    // axis is 0 (local x), 1 (local y) or 2 (local z).
    const boxRadiusAlongLocalAxis = (axis: 0 | 1 | 2) =>
      bucketHalfSize[0] * Math.abs(dLocalDWorldX[axis]) +
      bucketHalfSize[1] * Math.abs(dLocalDWorldY[axis]) +
      bucketHalfSize[2] * Math.abs(dLocalDWorldZ[axis]);

    const radiusLocalX = boxRadiusAlongLocalAxis(0);
    const radiusLocalY = boxRadiusAlongLocalAxis(1);
    const radiusLocalZ = boxRadiusAlongLocalAxis(2);

    const bucketCenterWorld = (bucketAddress: Vector3): Vector3 => [
      bucketAddress[0] * voxelSize[0] + bucketHalfSize[0],
      bucketAddress[1] * voxelSize[1] + bucketHalfSize[1],
      bucketAddress[2] * voxelSize[2] + bucketHalfSize[2],
    ];

    // Exact test: does this bucket's box intersect the plane rectangle? No sampling
    // involved, so there's no rotation angle at which this can miss a bucket.
    const intersectsPlane = (bucketAddress: Vector3): boolean => {
      const [localX, localY, localZ] = M4x4.transformVectorsAffine(inverseMatrix, [
        bucketCenterWorld(bucketAddress),
      ])[0];
      return (
        Math.abs(localZ) <= radiusLocalZ &&
        Math.abs(localX) <= enlargedHalfExtent[0] + radiusLocalX &&
        Math.abs(localY) <= enlargedHalfExtent[1] + radiusLocalY
      );
    };

    // The seed bucket is trusted unconditionally (the camera position it's derived from lies
    // on the plane by construction); only its neighbours are filtered by intersectsPlane.
    const visited = new Set<number>([hashPosition(seedAddress)]);
    const queue: Array<Vector3> = [seedAddress];

    for (let head = 0; head < queue.length; head++) {
      const current = queue[head];
      const currentHash = hashPosition(current);

      if (!enqueuedBucketHashes.has(currentHash)) {
        enqueuedBucketHashes.add(currentHash);

        const priority =
          Math.abs(current[0] - centerAddress[0]) +
          Math.abs(current[1] - centerAddress[1]) +
          Math.abs(current[2] - centerAddress[2]);
        enqueueFunction(
          [current[0], current[1], current[2], logZoomStep],
          priority + additionalPriorityWeight,
        );

        if (abortLimit != null && enqueuedBucketHashes.size > abortLimit) {
          return;
        }
      }

      for (const [dx, dy, dz] of NEIGHBOR_OFFSETS) {
        const neighbor: Vector3 = [current[0] + dx, current[1] + dy, current[2] + dz];
        const neighborHash = hashPosition(neighbor);

        if (visited.has(neighborHash)) {
          continue;
        }
        visited.add(neighborHash);

        if (intersectsPlane(neighbor)) {
          // Visualizes the flood fill's traversal edges, reusing the same debug-line
          // plumbing that oblique_bucket_picker.ts uses for its scan lines.
          onScanLine?.(bucketCenterWorld(current), bucketCenterWorld(neighbor));
          queue.push(neighbor);
        }
      }
    }
  }
}
