import { M4x4 } from "libs/mjs";
import type { Matrix4x4 } from "mjs";
import type { OrthoViewWithoutTD, Vector3 } from "viewer/constants";
import constants from "viewer/constants";
import type { EnqueueFunction } from "viewer/model/bucket_data_handling/layer_rendering_manager";
import {
  getBucketExtent,
  globalPositionToBucketPosition,
} from "viewer/model/helpers/position_converter";
import type { LoadingStrategy, PlaneRects } from "viewer/store";
import { getPriorityWeightForZoomStepDiff, MAX_ZOOM_STEP_DIFF } from "../loading_strategy_logic";

// Determines the buckets of the three orthogonal viewport planes row by row.
//
// Each plane's region is a box: the viewport rectangle, thickened along the plane's normal for
// prefetching (see PREFETCH_BUCKET_FRACTION). A bucket is picked if it overlaps one of the
// boxes with positive volume, using an exact separating-axis test. Each bucket is grown by
// INTERPOLATION_MARGIN for this test (see there). In bucket coordinates, a box
// is a parallelepiped with three edge directions, so 15 axes suffice: its 3 face normals, the 3
// bucket axes and the 9 cross products of a bucket axis with an edge direction. The three
// planes are the same box orientation with permuted axes, so they share these axes and only
// differ in their bounds.
//
// For a fixed row (y, z), every condition of the test is linear in x, so a plane's buckets in
// a row form one contiguous interval. Its ends are computed per row and then corrected with the
// exact test (to be robust against rounding and to decide ties like the test). The interior of
// an interval is emitted without testing. The three planes' intervals are merged per row, so
// that no bucket is emitted twice.

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

// Buckets are also picked that the plane would intersect if it moved by up to this fraction of
// a bucket's thickness along its normal, so that data is already loaded when the user moves
// along the view axis. Being < 1, this never reaches past the adjacent bucket layer,
// independent of zoom, mags and rotation.
export const PREFETCH_BUCKET_FRACTION = 0.3;

const PLANE_IDS: Array<OrthoViewWithoutTD> = ["PLANE_XY", "PLANE_XZ", "PLANE_YZ"];

// With interpolation, the shader also reads the neighbouring voxel of a sampled position (see
// filtering.glsl.ts). So buckets that are up to one voxel away from a plane's region are picked,
// too. Otherwise, pixels at the border of the viewport could fall back to a coarser mag. The
// margin is in bucket units, i.e., one voxel of the respective mag.
const INTERPOLATION_MARGIN = 1 / constants.BUCKET_WIDTH;
const PLANE_COUNT = PLANE_IDS.length;

type PlaneBox = {
  // The box is center + u·edges[0..2] + v·edges[3..5] + w·edges[6..8] (in world coordinates)
  // with |u| <= halfExtentU, |v| <= halfExtentV and |w| <= the prefetch half thickness.
  edges: Float64Array;
  halfExtentU: number;
  halfExtentV: number;
  // The plane's normal as a row of the inverse matrix (world → local z).
  normal: Vector3;
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
  // The planes' matrices don't depend on the mag, so they're set up once per pick.
  const planeBoxes = PLANE_IDS.map((planeId) => getPlaneBox(planeId, matrix, rects));
  const center: Vector3 = [matrix[12], matrix[13], matrix[14]];

  let zoomStepDiff = 0;
  while (logZoomStep + zoomStepDiff < denseMags.length && zoomStepDiff <= MAX_ZOOM_STEP_DIFF) {
    addBucketsOfLevel(
      loadingStrategy,
      denseMags,
      position,
      enqueueFunction,
      planeBoxes,
      center,
      logZoomStep,
      zoomStepDiff,
      abortLimit,
    );
    zoomStepDiff++;
  }
}

function getPlaneBox(planeId: OrthoViewWithoutTD, matrix: Matrix4x4, rects: PlaneRects): PlaneBox {
  const queryMatrix = [...matrix] as Matrix4x4;
  if (planeId === "PLANE_YZ") {
    M4x4.mul(matrix, ROTATIONS.YZ, queryMatrix);
  } else if (planeId === "PLANE_XZ") {
    M4x4.mul(matrix, ROTATIONS.XZ, queryMatrix);
  }
  const inverse = M4x4.inverse(queryMatrix);
  // mjs matrices are column-major, so the columns are the images of the local axes.
  const edges = new Float64Array([
    queryMatrix[0],
    queryMatrix[1],
    queryMatrix[2],
    queryMatrix[4],
    queryMatrix[5],
    queryMatrix[6],
    queryMatrix[8],
    queryMatrix[9],
    queryMatrix[10],
  ]);
  return {
    edges,
    halfExtentU: Math.ceil(rects[planeId].width / 2),
    halfExtentV: Math.ceil(rects[planeId].height / 2),
    normal: [inverse[2], inverse[6], inverse[10]],
  };
}

function cross(
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  out: number[],
): void {
  out.push(ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx);
}

// Returns the candidate axes as a flat array (x, y, z per axis), without zero-length and
// (anti-)parallel duplicates. The duplicates are common, e.g., for axis-aligned views.
function getAxes(edges: Float64Array): number[] {
  const candidates: number[] = [];
  const [e1x, e1y, e1z, e2x, e2y, e2z, e3x, e3y, e3z] = edges;
  cross(e2x, e2y, e2z, e3x, e3y, e3z, candidates);
  cross(e3x, e3y, e3z, e1x, e1y, e1z, candidates);
  cross(e1x, e1y, e1z, e2x, e2y, e2z, candidates);
  candidates.push(1, 0, 0, 0, 1, 0, 0, 0, 1);
  for (let bucketAxis = 0; bucketAxis < 3; bucketAxis++) {
    const bx = bucketAxis === 0 ? 1 : 0;
    const by = bucketAxis === 1 ? 1 : 0;
    const bz = bucketAxis === 2 ? 1 : 0;
    for (let edge = 0; edge < 3; edge++) {
      cross(bx, by, bz, edges[3 * edge], edges[3 * edge + 1], edges[3 * edge + 2], candidates);
    }
  }

  const axes: number[] = [];
  for (let i = 0; i < candidates.length; i += 3) {
    const ax = candidates[i];
    const ay = candidates[i + 1];
    const az = candidates[i + 2];
    const lengthSquared = ax * ax + ay * ay + az * az;
    if (lengthSquared < 1e-24) {
      continue;
    }
    let isDuplicate = false;
    for (let j = 0; j < axes.length; j += 3) {
      const bx = axes[j];
      const by = axes[j + 1];
      const bz = axes[j + 2];
      const cx = ay * bz - az * by;
      const cy = az * bx - ax * bz;
      const cz = ax * by - ay * bx;
      const otherLengthSquared = bx * bx + by * by + bz * bz;
      if (cx * cx + cy * cy + cz * cz <= 1e-20 * lengthSquared * otherLengthSquared) {
        isDuplicate = true;
        break;
      }
    }
    if (!isDuplicate) {
      axes.push(ax, ay, az);
    }
  }
  return axes;
}

function addBucketsOfLevel(
  loadingStrategy: LoadingStrategy,
  denseMags: Array<Vector3>,
  position: Vector3,
  enqueueFunction: EnqueueFunction,
  planeBoxes: PlaneBox[],
  worldCenter: Vector3,
  nonFallbackLogZoomStep: number,
  zoomStepDiff: number,
  abortLimit: number | undefined,
): void {
  const logZoomStep = nonFallbackLogZoomStep + zoomStepDiff;
  // null is passed as additionalCoordinates, since the bucket picker doesn't care about the
  // additional coordinates. It simply sticks to 3D and the caller is responsible for augmenting
  // potential other coordinates.
  const centerAddress = globalPositionToBucketPosition(position, denseMags, logZoomStep, null);
  const centerX = centerAddress[0];
  const centerY = centerAddress[1];
  const centerZ = centerAddress[2];
  const additionalPriorityWeight = getPriorityWeightForZoomStepDiff(loadingStrategy, zoomStepDiff);
  const bucketExtent = getBucketExtent(denseMags[logZoomStep]);
  // The prefetch distance is based on the buckets of the rendered (non-fallback) mag, so that
  // fallback levels cover the same movement instead of a proportionally larger one.
  const prefetchBucketExtent = getBucketExtent(denseMags[nonFallbackLogZoomStep]);

  // Everything below is in bucket coordinates (world / bucketExtent), in which a bucket with
  // address (x, y, z) is the unit cube with min corner (x, y, z).
  const center = [
    worldCenter[0] / bucketExtent[0],
    worldCenter[1] / bucketExtent[1],
    worldCenter[2] / bucketExtent[2],
  ];
  const planeEdges: Float64Array[] = [];
  const halfThicknesses: number[] = [];
  for (const box of planeBoxes) {
    const edges = new Float64Array(9);
    for (let edge = 0; edge < 3; edge++) {
      for (let d = 0; d < 3; d++) {
        edges[3 * edge + d] = box.edges[3 * edge + d] / bucketExtent[d];
      }
    }
    planeEdges.push(edges);
    halfThicknesses.push(
      PREFETCH_BUCKET_FRACTION *
        (prefetchBucketExtent[0] * Math.abs(box.normal[0]) +
          prefetchBucketExtent[1] * Math.abs(box.normal[1]) +
          prefetchBucketExtent[2] * Math.abs(box.normal[2])),
    );
  }

  const axes = getAxes(planeEdges[0]);
  const axisCount = axes.length / 3;
  // A bucket with min corner p overlaps plane box b iff lower[b][k] < axis_k·p < upper[b][k]
  // for every axis k. The bounds fold in the (grown) bucket's center offset and radius per axis.
  const lower = new Float64Array(PLANE_COUNT * axisCount);
  const upper = new Float64Array(PLANE_COUNT * axisCount);
  for (let k = 0; k < axisCount; k++) {
    const ax = axes[3 * k];
    const ay = axes[3 * k + 1];
    const az = axes[3 * k + 2];
    const projectedCenter = ax * center[0] + ay * center[1] + az * center[2];
    const bucketCenterOffset = 0.5 * (ax + ay + az);
    const bucketRadius =
      (0.5 + INTERPOLATION_MARGIN) * (Math.abs(ax) + Math.abs(ay) + Math.abs(az));
    for (let b = 0; b < PLANE_COUNT; b++) {
      const edges = planeEdges[b];
      const box = planeBoxes[b];
      const boxRadius =
        box.halfExtentU * Math.abs(ax * edges[0] + ay * edges[1] + az * edges[2]) +
        box.halfExtentV * Math.abs(ax * edges[3] + ay * edges[4] + az * edges[5]) +
        halfThicknesses[b] * Math.abs(ax * edges[6] + ay * edges[7] + az * edges[8]);
      lower[b * axisCount + k] = projectedCenter - bucketCenterOffset - boxRadius - bucketRadius;
      upper[b * axisCount + k] = projectedCenter - bucketCenterOffset + boxRadius + bucketRadius;
    }
  }

  // Axes perpendicular to x constrain whole rows, the others constrain x within a row.
  const rowAxes: number[] = [];
  const xAxes: number[] = [];
  const inverseAxisX = new Float64Array(axisCount);
  for (let k = 0; k < axisCount; k++) {
    if (axes[3 * k] === 0) {
      rowAxes.push(k);
    } else {
      xAxes.push(k);
      inverseAxisX[k] = 1 / axes[3 * k];
    }
  }

  const overlaps = (b: number, x: number, y: number, z: number): boolean => {
    const offset = b * axisCount;
    for (let k = 0; k < axisCount; k++) {
      const projection = axes[3 * k] * x + axes[3 * k + 1] * y + axes[3 * k + 2] * z;
      if (projection <= lower[offset + k] || projection >= upper[offset + k]) {
        return false;
      }
    }
    return true;
  };

  // Per plane, only buckets within the box's bounding box can overlap it.
  const boxMin = new Int32Array(3 * PLANE_COUNT);
  const boxMax = new Int32Array(3 * PLANE_COUNT);
  for (let b = 0; b < PLANE_COUNT; b++) {
    const edges = planeEdges[b];
    const box = planeBoxes[b];
    for (let d = 0; d < 3; d++) {
      const radius =
        box.halfExtentU * Math.abs(edges[d]) +
        box.halfExtentV * Math.abs(edges[3 + d]) +
        halfThicknesses[b] * Math.abs(edges[6 + d]);
      boxMin[3 * b + d] = Math.floor(center[d] - radius - INTERPOLATION_MARGIN);
      boxMax[3 * b + d] = Math.floor(center[d] + radius + INTERPOLATION_MARGIN);
    }
  }
  const minY = Math.min(boxMin[1], boxMin[4], boxMin[7]);
  const maxY = Math.max(boxMax[1], boxMax[4], boxMax[7]);
  const minZ = Math.min(boxMin[2], boxMin[5], boxMin[8]);
  const maxZ = Math.max(boxMax[2], boxMax[5], boxMax[8]);

  const firsts = [0, 0, 0];
  const lasts = [0, 0, 0];
  let enqueuedCount = 0;

  for (let z = minZ; z <= maxZ; z++) {
    for (let y = minY; y <= maxY; y++) {
      // The intervals of the three planes in this row.
      let intervalCount = 0;
      for (let b = 0; b < PLANE_COUNT; b++) {
        if (
          y < boxMin[3 * b + 1] ||
          y > boxMax[3 * b + 1] ||
          z < boxMin[3 * b + 2] ||
          z > boxMax[3 * b + 2]
        ) {
          continue;
        }
        const offset = b * axisCount;
        let isRowEmpty = false;
        for (let i = 0; i < rowAxes.length; i++) {
          const k = rowAxes[i];
          const projection = axes[3 * k + 1] * y + axes[3 * k + 2] * z;
          if (projection <= lower[offset + k] || projection >= upper[offset + k]) {
            isRowEmpty = true;
            break;
          }
        }
        if (isRowEmpty) {
          continue;
        }

        // Overlapping buckets satisfy lowerX < x < upperX (up to rounding).
        let lowerX = Number.NEGATIVE_INFINITY;
        let upperX = Number.POSITIVE_INFINITY;
        for (let i = 0; i < xAxes.length; i++) {
          const k = xAxes[i];
          const rest = axes[3 * k + 1] * y + axes[3 * k + 2] * z;
          const a = (lower[offset + k] - rest) * inverseAxisX[k];
          const c = (upper[offset + k] - rest) * inverseAxisX[k];
          if (a < c) {
            lowerX = Math.max(lowerX, a);
            upperX = Math.min(upperX, c);
          } else {
            lowerX = Math.max(lowerX, c);
            upperX = Math.min(upperX, a);
          }
        }
        const minX = boxMin[3 * b];
        const maxX = boxMax[3 * b];
        const firstCandidate = Math.max(minX, Math.floor(lowerX));
        const lastCandidate = Math.min(maxX, Math.ceil(upperX));
        if (firstCandidate > lastCandidate) {
          continue;
        }

        // Correct the ends with the exact test. The accepted buckets of a row are contiguous.
        let first = firstCandidate;
        while (first <= lastCandidate && !overlaps(b, first, y, z)) {
          first++;
        }
        if (first > lastCandidate) {
          continue;
        }
        if (first === firstCandidate) {
          while (first > minX && overlaps(b, first - 1, y, z)) first--;
        }
        let last = lastCandidate;
        while (!overlaps(b, last, y, z)) {
          last--;
        }
        if (last === lastCandidate) {
          while (last < maxX && overlaps(b, last + 1, y, z)) last++;
        }

        // Insert sorted by first.
        let insertAt = intervalCount;
        while (insertAt > 0 && firsts[insertAt - 1] > first) {
          firsts[insertAt] = firsts[insertAt - 1];
          lasts[insertAt] = lasts[insertAt - 1];
          insertAt--;
        }
        firsts[insertAt] = first;
        lasts[insertAt] = last;
        intervalCount++;
      }

      // Emit the union of the intervals.
      let emittedUpTo = Number.NEGATIVE_INFINITY;
      for (let i = 0; i < intervalCount; i++) {
        const start = Math.max(firsts[i], emittedUpTo + 1);
        for (let x = start; x <= lasts[i]; x++) {
          const priority = Math.abs(x - centerX) + Math.abs(y - centerY) + Math.abs(z - centerZ);
          enqueueFunction([x, y, z, logZoomStep], priority + additionalPriorityWeight);
          enqueuedCount++;
          if (abortLimit != null && enqueuedCount >= abortLimit) {
            return;
          }
        }
        emittedUpTo = Math.max(emittedUpTo, lasts[i]);
      }
    }
  }
}
