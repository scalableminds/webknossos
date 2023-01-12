import _ from "lodash";
import type { EnqueueFunction } from "oxalis/model/bucket_data_handling/layer_rendering_manager";
import type { Matrix4x4 } from "libs/mjs";
import { M4x4, V3 } from "libs/mjs";
import { chunk2 } from "oxalis/model/helpers/chunk";
import {
  zoomedAddressToAnotherZoomStep,
  globalPositionToBucketPosition,
} from "oxalis/model/helpers/position_converter";
import ThreeDMap from "libs/ThreeDMap";
import type { OrthoViewMap, Vector3, Vector4 } from "oxalis/constants";
import constants from "oxalis/constants";
import traverse from "oxalis/model/bucket_data_handling/bucket_traversals";
import { Area } from "oxalis/model/accessors/flycam_accessor";

// Note that the fourth component of Vector4 (if passed) is ignored, as it's not needed
// in this use case (only one mag at a time is gathered).
const hashPosition = ([x, y, z]: Vector3 | Vector4): number => 2 ** 32 * x + 2 ** 16 * y + z;

const makeBucketsUnique = (buckets: Vector3[]) => _.uniqBy(buckets, hashPosition);

export const getFallbackBuckets = (
  buckets: Vector4[],
  resolutions: Vector3[],
  fallbackZoomStep: number,
  isFallbackAvailable: boolean,
): Vector4[] => {
  return isFallbackAvailable
    ? _.uniqBy(
        buckets.map((bucketAddress: Vector4) =>
          zoomedAddressToAnotherZoomStep(bucketAddress, resolutions, fallbackZoomStep),
        ),
        hashPosition,
      )
    : [];
};
export default function determineBucketsForOblique(
  resolutions: Array<Vector3>,
  position: Vector3,
  enqueueFunction: EnqueueFunction,
  matrix: Matrix4x4,
  logZoomStep: number,
  areas: OrthoViewMap<Area>,
  abortLimit?: number,
): void {
  debugger;
  const uniqueBucketMap = new ThreeDMap();
  let currentCount = 0;
  const queryMatrix = M4x4.scale1(1, matrix);
  const fallbackZoomStep = logZoomStep + 1;
  const isFallbackAvailable = fallbackZoomStep < resolutions.length;

  const planeId = "PLANE_XY";
  const extent = [
    constants.BUCKET_WIDTH * (areas[planeId].right - areas[planeId].left),
    constants.BUCKET_WIDTH * (areas[planeId].bottom - areas[planeId].top),
  ];
  const enlargedHalfExtent = [Math.ceil(extent[0] / 2), Math.ceil(extent[1] / 2)];

  // Buckets adjacent to the current viewport are also loaded so that these
  // buckets are already on the GPU when the user moves a little.
  // const enlargementFactor = 1.1;
  // const enlargedExtent = constants.VIEWPORT_WIDTH * enlargementFactor;
  // const enlargedHalfExtent = enlargedExtent / 2;
  // Cast a vertical "scan line" and check how many buckets are intersected.
  // That amount N is used as a measure to cast N + 1 (steps) vertical scanlines.
  const stepRatePoints = M4x4.transformVectorsAffine(queryMatrix, [
    [-enlargedHalfExtent[0], -enlargedHalfExtent[1], 0],
    [-enlargedHalfExtent[0], +enlargedHalfExtent[1], 0],
  ]);
  const stepRateBuckets = traverse(stepRatePoints[0], stepRatePoints[1], resolutions, logZoomStep);
  const steps = stepRateBuckets.length + 1;
  const stepSize = [extent[0] / steps, extent[1] / steps];
  // This array holds the start and end points
  // of horizontal lines which cover the entire rendered plane.
  // These "scan lines" are traversed to find out which buckets need to be
  // sent to the GPU.
  const scanLinesPoints = M4x4.transformVectorsAffine(
    queryMatrix,
    _.flatten(
      _.range(steps + 1).map((idx) => [
        // Cast lines at z=-10
        [-enlargedHalfExtent[0], -enlargedHalfExtent[1] + idx * stepSize[1], -10],
        [enlargedHalfExtent[0], -enlargedHalfExtent[1] + idx * stepSize[1], -10],
        // Cast lines at z=0
        [-enlargedHalfExtent[0], -enlargedHalfExtent[1] + idx * stepSize[1], 0],
        [enlargedHalfExtent[0], -enlargedHalfExtent[1] + idx * stepSize[1], 0],
        // Cast lines at z=10
        [-enlargedHalfExtent[0], -enlargedHalfExtent[1] + idx * stepSize[1], 10],
        [enlargedHalfExtent[0], -enlargedHalfExtent[1] + idx * stepSize[1], 10],
      ]),
    ),
  );

  let traversedBuckets = _.flatten(
    chunk2(scanLinesPoints).map(([a, b]: [Vector3, Vector3]) =>
      traverse(a, b, resolutions, logZoomStep),
    ),
  );

  traversedBuckets = makeBucketsUnique(traversedBuckets);
  console.log("traversedBuckets.length", traversedBuckets.length);
  let traversedBucketsVec4 = traversedBuckets.map((addr): Vector4 => [...addr, logZoomStep]);
  const fallbackBuckets = getFallbackBuckets(
    traversedBucketsVec4,
    resolutions,
    fallbackZoomStep,
    isFallbackAvailable,
  );
  traversedBucketsVec4 = traversedBucketsVec4.concat(fallbackBuckets);
  const centerAddress = globalPositionToBucketPosition(position, resolutions, logZoomStep);

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
      enqueueFunction(bucketAddress, priority);
    }
  }
}
