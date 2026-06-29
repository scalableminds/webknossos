import { M4x4 } from "libs/mjs";
import range from "lodash-es/range";
import type { Matrix4x4 } from "mjs";
import type { OrthoViewWithoutTD, Vector2, Vector3, Vector4 } from "viewer/constants";
import traverse from "viewer/model/bucket_data_handling/bucket_traversals";
import type { EnqueueFunction } from "viewer/model/bucket_data_handling/layer_rendering_manager";
import { chunk2 } from "viewer/model/helpers/chunk";
import { globalPositionToBucketPosition } from "viewer/model/helpers/position_converter";
import type { LoadingStrategy, PlaneRects } from "viewer/store";
import { getPriorityWeightForZoomStepDiff, MAX_ZOOM_STEP_DIFF } from "../loading_strategy_logic";

// Note that the fourth component of Vector4 (if passed) is ignored, as it's not needed
// in this use case (only one mag at a time is gathered).
const hashPosition = ([x, y, z]: Vector3 | Vector4): number => 2 ** 32 * x + 2 ** 16 * y + z;

const ALPHA = Math.PI / 2;

// biome-ignore format: don't format array
const ROTATIONS = {
  YZ: [
    Math.cos(ALPHA),
    0,
    Math.sin(ALPHA),
    0,
    0,
    1,
    0,
    0,
    -Math.sin(ALPHA),
    0,
    Math.cos(ALPHA),
    0,
    0,
    0,
    0,
    1,
  ] as Matrix4x4,
  XZ: [
    1,
    0,
    0,
    0,
    0,
    Math.cos(ALPHA),
    -Math.sin(ALPHA),
    0,
    0,
    Math.sin(ALPHA),
    Math.cos(ALPHA),
    0,
    0,
    0,
    0,
    1,
  ] as Matrix4x4,
};

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
    addNecessaryBucketsToPriorityQueueOblique(
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

function addNecessaryBucketsToPriorityQueueOblique(
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
  const seenBucketHashes = new Set<number>();

  // null is passed as additionalCoordinates, since the bucket picker doesn't care about the
  // additional coordinates. It simply sticks to 3D and the caller is responsible for augmenting
  // potential other coordinates.
  const centerAddress = globalPositionToBucketPosition(position, denseMags, logZoomStep, null);
  const additionalPriorityWeight = getPriorityWeightForZoomStepDiff(loadingStrategy, zoomStepDiff);

  for (const planeId of planeIds) {
    let extent: Vector2;
    let enlargedExtent: Vector2;
    let enlargedHalfExtent: Vector2;
    const queryMatrix = [...matrix] as Matrix4x4;

    extent = [rects[planeId].width, rects[planeId].height];
    enlargedHalfExtent = [Math.ceil(extent[0] / 2), Math.ceil(extent[1] / 2)] as Vector2;
    enlargedExtent = [enlargedHalfExtent[0] * 2, enlargedHalfExtent[1] * 2];
    if (planeId === "PLANE_YZ") {
      M4x4.mul(matrix, ROTATIONS.YZ, queryMatrix);
    } else if (planeId === "PLANE_XZ") {
      M4x4.mul(matrix, ROTATIONS.XZ, queryMatrix);
    }

    // Cast a vertical "scan line" and check how many buckets are intersected.
    // That amount N is used as a measure to cast N + 1 (steps) vertical scanlines.
    const stepRatePoints = M4x4.transformVectorsAffine(queryMatrix, [
      [-enlargedHalfExtent[0], -enlargedHalfExtent[1], 0],
      [-enlargedHalfExtent[0], +enlargedHalfExtent[1], 0],
    ]);
    const stepRateBuckets = traverse(stepRatePoints[0], stepRatePoints[1], denseMags, logZoomStep);
    const steps = stepRateBuckets.length + 1;
    const stepSize = [enlargedExtent[0] / steps, enlargedExtent[1] / steps];
    // This array holds the start and end points
    // of horizontal lines which cover the entire rendered plane.
    // These "scan lines" are traversed to find out which buckets need to be
    // sent to the GPU.
    const zDiff = 10;
    const scanLinesPoints = M4x4.transformVectorsAffine(
      queryMatrix,
      range(steps + 1).flatMap((idx) => [
        // Cast lines at z=-10
        [-enlargedHalfExtent[0], -enlargedHalfExtent[1] + idx * stepSize[1], -zDiff],
        [enlargedHalfExtent[0], -enlargedHalfExtent[1] + idx * stepSize[1], -zDiff],
        // Cast lines at z=0
        [-enlargedHalfExtent[0], -enlargedHalfExtent[1] + idx * stepSize[1], 0],
        [enlargedHalfExtent[0], -enlargedHalfExtent[1] + idx * stepSize[1], 0],
        // Cast lines at z=10
        [-enlargedHalfExtent[0], -enlargedHalfExtent[1] + idx * stepSize[1], zDiff],
        [enlargedHalfExtent[0], -enlargedHalfExtent[1] + idx * stepSize[1], zDiff],
      ]),
    );

    for (const [a, b] of chunk2(scanLinesPoints)) {
      for (const bucketAddress of traverse(a, b, denseMags, logZoomStep)) {
        const bucketHash = hashPosition(bucketAddress);
        if (seenBucketHashes.has(bucketHash)) {
          // Ignore bucket as we already saw it
          continue;
        }
        seenBucketHashes.add(bucketHash);
        if (abortLimit != null && seenBucketHashes.size > abortLimit) {
          return;
        }
        const priority =
          // No V3.sub for performance reasons
          Math.abs(bucketAddress[0] - centerAddress[0]) +
          Math.abs(bucketAddress[1] - centerAddress[1]) +
          Math.abs(bucketAddress[2] - centerAddress[2]);
        enqueueFunction(
          // Don't use ...bucketAddress for performance and better typechecking
          [bucketAddress[0], bucketAddress[1], bucketAddress[2], logZoomStep],
          priority + additionalPriorityWeight,
        );
      }
    }
  }
}
