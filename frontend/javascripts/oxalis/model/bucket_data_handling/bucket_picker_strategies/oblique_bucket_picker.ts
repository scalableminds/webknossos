import ThreeDMap from "libs/ThreeDMap";
import type { Matrix4x4 } from "libs/mjs";
import { M4x4, V3 } from "libs/mjs";
import _ from "lodash";
import type { OrthoViewWithoutTD, Vector2, Vector3, Vector4, ViewMode } from "oxalis/constants";
import constants from "oxalis/constants";
import traverse from "oxalis/model/bucket_data_handling/bucket_traversals";
import type { EnqueueFunction } from "oxalis/model/bucket_data_handling/layer_rendering_manager";
import { chunk2 } from "oxalis/model/helpers/chunk";
import { globalPositionToBucketPosition } from "oxalis/model/helpers/position_converter";
import type { LoadingStrategy, PlaneRects } from "oxalis/store";
import { MAX_ZOOM_STEP_DIFF, getPriorityWeightForZoomStepDiff } from "../loading_strategy_logic";

// Note that the fourth component of Vector4 (if passed) is ignored, as it's not needed
// in this use case (only one mag at a time is gathered).
const hashPosition = ([x, y, z]: Vector3 | Vector4): number => 2 ** 32 * x + 2 ** 16 * y + z;

const makeBucketsUnique = (buckets: Vector3[]) => _.uniqBy(buckets, hashPosition);

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
    0, Math.cos(ALPHA), -Math.sin(ALPHA), 0,
    0, Math.sin(ALPHA), Math.cos(ALPHA), 0,
    0, 0, 0, 1,
  ] as Matrix4x4
}

export default function determineBucketsForOblique(
  viewMode: ViewMode,
  loadingStrategy: LoadingStrategy,
  mags: Array<Vector3>,
  position: Vector3,
  enqueueFunction: EnqueueFunction,
  matrix: Matrix4x4,
  logZoomStep: number,
  rects: PlaneRects,
  abortLimit?: number,
): void {
  let zoomStepDiff = 0;

  while (logZoomStep + zoomStepDiff < mags.length && zoomStepDiff <= MAX_ZOOM_STEP_DIFF) {
    addNecessaryBucketsToPriorityQueueOblique(
      loadingStrategy,
      viewMode,
      mags,
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
  viewMode: ViewMode,
  mags: Array<Vector3>,
  position: Vector3,
  enqueueFunction: EnqueueFunction,
  matrix: Matrix4x4,
  nonFallbackLogZoomStep: number,
  zoomStepDiff: number,
  rects: PlaneRects,
  abortLimit?: number,
): void {
  const logZoomStep = nonFallbackLogZoomStep + zoomStepDiff;
  const uniqueBucketMap = new ThreeDMap();
  let currentCount = 0;

  const planeIds: Array<OrthoViewWithoutTD> =
    viewMode === "orthogonal" ? ["PLANE_XY", "PLANE_XZ", "PLANE_YZ"] : ["PLANE_XY"];
  let traversedBuckets: Vector3[] = [];
  for (const planeId of planeIds) {
    let extent: Vector2;
    let enlargedExtent: Vector2;
    let enlargedHalfExtent: Vector2;
    const queryMatrix = [...matrix] as Matrix4x4;

    if (viewMode === "orthogonal") {
      extent = [rects[planeId].width, rects[planeId].height];
      enlargedHalfExtent = [Math.ceil(extent[0] / 2), Math.ceil(extent[1] / 2)] as Vector2;
      enlargedExtent = [enlargedHalfExtent[0] * 2, enlargedHalfExtent[1] * 2];
      if (planeId === "PLANE_YZ") {
        M4x4.mul(matrix, ROTATIONS.YZ, queryMatrix);
      } else if (planeId === "PLANE_XZ") {
        M4x4.mul(matrix, ROTATIONS.XZ, queryMatrix);
      }
    } else {
      // Buckets adjacent to the current viewport are also loaded so that these
      // buckets are already on the GPU when the user moves a little.
      extent = [constants.VIEWPORT_WIDTH, constants.VIEWPORT_WIDTH];
      const enlargementFactor = 1.1;
      enlargedExtent = [
        constants.VIEWPORT_WIDTH * enlargementFactor,
        constants.VIEWPORT_WIDTH * enlargementFactor,
      ];
      enlargedHalfExtent = [enlargedExtent[0] / 2, enlargedExtent[1] / 2] as Vector2;
    }

    // Cast a vertical "scan line" and check how many buckets are intersected.
    // That amount N is used as a measure to cast N + 1 (steps) vertical scanlines.
    const stepRatePoints = M4x4.transformVectorsAffine(queryMatrix, [
      [-enlargedHalfExtent[0], -enlargedHalfExtent[1], 0],
      [-enlargedHalfExtent[0], +enlargedHalfExtent[1], 0],
    ]);
    const stepRateBuckets = traverse(stepRatePoints[0], stepRatePoints[1], mags, logZoomStep);
    const steps = stepRateBuckets.length + 1;
    const stepSize = [enlargedExtent[0] / steps, enlargedExtent[1] / steps];
    // This array holds the start and end points
    // of horizontal lines which cover the entire rendered plane.
    // These "scan lines" are traversed to find out which buckets need to be
    // sent to the GPU.
    const zDiff = 10;
    const scanLinesPoints = M4x4.transformVectorsAffine(
      queryMatrix,
      _.flatten(
        _.range(steps + 1).map((idx) => [
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
      ),
    );

    for (const [a, b] of chunk2(scanLinesPoints)) {
      for (const bucket of traverse(a, b, mags, logZoomStep)) {
        traversedBuckets.push(bucket);
      }
    }
  }

  traversedBuckets = makeBucketsUnique(traversedBuckets);
  const traversedBucketsVec4 = traversedBuckets.map((addr): Vector4 => [...addr, logZoomStep]);

  // null is passed as additionalCoordinates, since the bucket picker doesn't care about the
  // additional coordinates. It simply sticks to 3D and the caller is responsible for augmenting
  // potential other coordinates.
  const centerAddress = globalPositionToBucketPosition(position, mags, logZoomStep, null);

  for (const bucketAddress of traversedBucketsVec4) {
    const bucketVector3 = bucketAddress.slice(0, 3) as any as Vector3;

    if (uniqueBucketMap.get(bucketVector3) == null) {
      uniqueBucketMap.set(bucketVector3, bucketAddress);
      currentCount++;

      if (abortLimit != null && currentCount > abortLimit) {
        return;
      }

      const priority = V3.sub(
        bucketAddress as unknown as Vector3,
        centerAddress as unknown as Vector3,
      ).reduce((a, b) => a + Math.abs(b), 0);
      const additionalPriorityWeight = getPriorityWeightForZoomStepDiff(
        loadingStrategy,
        zoomStepDiff,
      );
      enqueueFunction(bucketAddress, priority + additionalPriorityWeight);
    }
  }
}
