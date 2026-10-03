import { M4x4, type Matrix4x4 } from "libs/mjs";
import type { Vector3, Vector4 } from "viewer/constants";
import constants, { UnitLong } from "viewer/constants";
import { _getDummyFlycamMatrix } from "viewer/model/accessors/flycam_accessor";
import determineBucketsForPlaneByRows, {
  PREFETCH_BUCKET_FRACTION,
  ROTATIONS,
} from "viewer/model/bucket_data_handling/bucket_picker_strategies/oblique_bucket_picker_rows";
import { MAX_ZOOM_STEP_DIFF } from "viewer/model/bucket_data_handling/loading_strategy_logic";
import { buildOverlapTest } from "viewer/model/bucket_data_handling/polyhedron_flood_fill";
import {
  getBucketExtent,
  globalPositionToBucketPosition,
} from "viewer/model/helpers/position_converter";
import type { PlaneRects } from "viewer/store";
import { describe, expect, it } from "vitest";

const ANISOTROPIC_MAGS: Vector3[] = [
  [1, 1, 1],
  [2, 2, 1],
  [4, 4, 2],
  [8, 8, 4],
  [16, 16, 8],
];
const ISOTROPIC_MAGS: Vector3[] = [
  [1, 1, 1],
  [2, 2, 2],
  [4, 4, 4],
  [8, 8, 8],
  [16, 16, 16],
];
const PLANE_IDS = ["PLANE_XY", "PLANE_XZ", "PLANE_YZ"] as const;
// The picker also picks buckets up to one voxel away from a plane region (for interpolation).
const MARGIN = 1 / constants.BUCKET_WIDTH;
function makeRects(width: number, height: number): PlaneRects {
  const rect = { width, height, top: 0, left: 0 };
  return { PLANE_XY: rect, PLANE_XZ: rect, PLANE_YZ: rect, TDView: rect };
}

// Like the matrix the layer rendering manager passes to the picker: the flycam matrix (scaled by
// the voxel size, rotated by 180° around z by default), rotated further, scaled by the zoom.
function makeMatrix(
  voxelSize: Vector3,
  anglesInDegrees: Vector3,
  position: Vector3,
  zoom: number,
): Matrix4x4 {
  let matrix = [..._getDummyFlycamMatrix({ factor: voxelSize, unit: UnitLong.nm })] as Matrix4x4;
  const axes: Vector3[] = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];
  anglesInDegrees.forEach((angle, i) => {
    if (angle !== 0) {
      matrix = M4x4.rotate((angle / 180) * Math.PI, axes[i], matrix, []) as Matrix4x4;
    }
  });
  matrix[12] = position[0];
  matrix[13] = position[1];
  matrix[14] = position[2];
  return M4x4.scale1(zoom, matrix) as Matrix4x4;
}

type Scenario = {
  name: string;
  mags: Vector3[];
  position: Vector3;
  matrix: Matrix4x4;
  logZoomStep: number;
  rects: PlaneRects;
};

function pick(
  scenario: Scenario,
  abortLimit?: number,
): { priorities: Map<string, number>; duplicateCount: number } {
  const priorities = new Map<string, number>();
  let duplicateCount = 0;
  determineBucketsForPlaneByRows(
    "BEST_QUALITY_FIRST",
    scenario.mags,
    scenario.position,
    (address: Vector4, priority: number) => {
      const key = address.join(",");
      if (priorities.has(key)) duplicateCount++;
      priorities.set(key, priority);
    },
    scenario.matrix,
    scenario.logZoomStep,
    scenario.rects,
    abortLimit,
  );
  return { priorities, duplicateCount };
}

// The vertices (in bucket coordinates) and edges of a plane region grown by a cube with half
// size margin: a bucket grown by the margin overlaps the region iff the bucket overlaps the grown
// region. The grown region is the convex hull of the region's corners, each shifted to all 8
// corners of the cube. Its edge directions are the region's and the cube's.
function getGrownRegion(
  queryMatrix: Matrix4x4,
  halfExtents: Vector3,
  bucketExtent: Vector3,
  margin: number,
): { vertices: number[]; edgeIndices: number[] } {
  const signs = [-1, 1];
  const vertices: number[] = [];
  for (const sx of signs) {
    for (const sy of signs) {
      for (const sz of signs) {
        const corner = M4x4.transformPointsAffine(queryMatrix, [
          sx * halfExtents[0],
          sy * halfExtents[1],
          sz * halfExtents[2],
        ]);
        for (const mx of signs) {
          for (const my of signs) {
            for (const mz of signs) {
              vertices.push(
                corner[0] / bucketExtent[0] + mx * margin,
                corner[1] / bucketExtent[1] + my * margin,
                corner[2] / bucketExtent[2] + mz * margin,
              );
            }
          }
        }
      }
    }
  }
  // Vertex index = 8 * regionCorner + cubeCorner, both with the bits (x, y, z) = (4, 2, 1).
  const offset = (regionCorner: number, cubeCorner: number) => 3 * (8 * regionCorner + cubeCorner);
  const edgeIndices = [
    offset(0, 0),
    offset(4, 0), // region edges
    offset(0, 0),
    offset(2, 0),
    offset(0, 0),
    offset(1, 0),
    offset(0, 0),
    offset(0, 4), // cube edges
    offset(0, 0),
    offset(0, 2),
    offset(0, 0),
    offset(0, 1),
  ];
  return { vertices, edgeIndices };
}

// The buckets that overlap one of the plane regions, with all sizes scaled by sizeScale. Uses the
// generic polyhedron test as an independent implementation of the exact test.
function getOverlappingBuckets(scenario: Scenario, sizeScale: number): Set<string> {
  const { mags, matrix, logZoomStep, rects } = scenario;
  const keys = new Set<string>();
  const prefetchBucketExtent = getBucketExtent(mags[logZoomStep]);
  for (let diff = 0; diff <= MAX_ZOOM_STEP_DIFF && logZoomStep + diff < mags.length; diff++) {
    const level = logZoomStep + diff;
    const bucketExtent = getBucketExtent(mags[level]);
    for (const planeId of PLANE_IDS) {
      const queryMatrix = [...matrix] as Matrix4x4;
      if (planeId === "PLANE_YZ") M4x4.mul(matrix, ROTATIONS.YZ, queryMatrix);
      if (planeId === "PLANE_XZ") M4x4.mul(matrix, ROTATIONS.XZ, queryMatrix);
      const inverse = M4x4.inverse(queryMatrix);
      const halfThickness =
        PREFETCH_BUCKET_FRACTION *
        (prefetchBucketExtent[0] * Math.abs(inverse[2]) +
          prefetchBucketExtent[1] * Math.abs(inverse[6]) +
          prefetchBucketExtent[2] * Math.abs(inverse[10]));
      const halfExtents: Vector3 = [
        Math.ceil(rects[planeId].width / 2) * sizeScale,
        Math.ceil(rects[planeId].height / 2) * sizeScale,
        halfThickness * sizeScale,
      ];
      const { vertices, edgeIndices } = getGrownRegion(
        queryMatrix,
        halfExtents,
        bucketExtent,
        MARGIN * sizeScale,
      );
      const overlaps = buildOverlapTest(vertices, edgeIndices);
      const min = [0, 1, 2].map(
        (d) => Math.floor(Math.min(...vertices.filter((_, i) => i % 3 === d))) - 1,
      );
      const max = [0, 1, 2].map(
        (d) => Math.floor(Math.max(...vertices.filter((_, i) => i % 3 === d))) + 1,
      );
      for (let x = min[0]; x <= max[0]; x++) {
        for (let y = min[1]; y <= max[1]; y++) {
          for (let z = min[2]; z <= max[2]; z++) {
            if (overlaps(x, y, z)) keys.add(`${x},${y},${z},${level}`);
          }
        }
      }
    }
  }
  return keys;
}

const POSITION: Vector3 = [12345.6, 9876.4, 2345.2];
const FOUR_PANE_RECTS = makeRects(572, 466.5);

const SCENARIOS: Scenario[] = [
  ["axis-aligned, zoom 1", [0, 0, 0], 1, 0, ANISOTROPIC_MAGS],
  ["axis-aligned, zoom 1.8", [0, 0, 0], 1.8, 0, ANISOTROPIC_MAGS],
  ["15° around x", [15, 0, 0], 1.3, 0, ANISOTROPIC_MAGS],
  ["45° around x", [45, 0, 0], 1.3, 0, ANISOTROPIC_MAGS],
  ["30°/20°/10°", [30, 20, 10], 1.3, 0, ANISOTROPIC_MAGS],
  ["30°/20°/10°, isotropic, mag index 1", [30, 20, 10], 3, 1, ISOTROPIC_MAGS],
  ["45°/45°/0°, isotropic", [45, 45, 0], 1, 0, ISOTROPIC_MAGS],
].map(([name, angles, zoom, logZoomStep, mags]) => {
  const isIsotropic = mags === ISOTROPIC_MAGS;
  const voxelSize: Vector3 = isIsotropic ? [1, 1, 1] : [11, 11, 24];
  return {
    name: name as string,
    mags: mags as Vector3[],
    position: POSITION,
    matrix: makeMatrix(voxelSize, angles as Vector3, POSITION, zoom as number),
    logZoomStep: logZoomStep as number,
    rects: FOUR_PANE_RECTS,
  };
});

function getRandomScenarios(count: number): Scenario[] {
  // Deterministic PRNG, so failures are reproducible.
  let seed = 7;
  const random = () => {
    seed = (seed * 1103515245 + 12345) % 2 ** 31;
    return seed / 2 ** 31;
  };
  const specialAngles = [0, 45, 90, 180];
  const scenarios: Scenario[] = [];
  for (let i = 0; i < count; i++) {
    // Every other case uses special angles and positions on bucket boundaries, to provoke ties.
    const isSpecial = i % 2 === 0;
    const angle = () =>
      isSpecial ? specialAngles[Math.floor(random() * specialAngles.length)] : random() * 360;
    const coordinate = () =>
      isSpecial ? 32 * (100 + Math.floor(random() * 20)) : 3000 + random() * 1000;
    const isIsotropic = random() < 0.5;
    const position: Vector3 = [coordinate(), coordinate(), coordinate()];
    scenarios.push({
      name: `random ${i}`,
      mags: isIsotropic ? ISOTROPIC_MAGS : ANISOTROPIC_MAGS,
      position,
      matrix: makeMatrix(
        isIsotropic ? [1, 1, 1] : [11, 11, 24],
        [angle(), angle(), angle()],
        position,
        0.5 + random() * 2,
      ),
      logZoomStep: Math.floor(random() * 3),
      rects: makeRects(100 + Math.floor(random() * 500), 100 + Math.floor(random() * 500)),
    });
  }
  return scenarios;
}

describe("Oblique bucket picker by rows", () => {
  for (const scenario of [...SCENARIOS, ...getRandomScenarios(40)]) {
    it(`picks exactly the buckets overlapping the plane regions (${scenario.name})`, () => {
      const { priorities, duplicateCount } = pick(scenario);
      expect(duplicateCount).toBe(0);

      // Every bucket that clearly overlaps a plane region is picked, and every picked bucket
      // overlaps one (the tolerance only matters for exact ties).
      const clearlyOverlapping = getOverlappingBuckets(scenario, 1 - 1e-9);
      const possiblyOverlapping = getOverlappingBuckets(scenario, 1 + 1e-9);
      const picked = [...priorities.keys()];
      expect([...clearlyOverlapping].filter((key) => !priorities.has(key))).toEqual([]);
      expect(picked.filter((key) => !possiblyOverlapping.has(key))).toEqual([]);

      // Priority: Manhattan distance to the camera's bucket, plus a weight per fallback level.
      for (const [key, priority] of priorities) {
        const [x, y, z, level] = key.split(",").map(Number);
        const center = globalPositionToBucketPosition(
          scenario.position,
          scenario.mags,
          level,
          null,
        );
        const distance =
          Math.abs(x - center[0]) + Math.abs(y - center[1]) + Math.abs(z - center[2]);
        expect(priority).toBe(distance + 1000 * (level - scenario.logZoomStep));
      }
    });
  }

  it("stops each level after abortLimit buckets", () => {
    const scenario = SCENARIOS[4];
    const unlimited = pick(scenario);
    const countPerLevel = new Map<string, number>();
    for (const key of unlimited.priorities.keys()) {
      const level = key.split(",")[3];
      countPerLevel.set(level, (countPerLevel.get(level) ?? 0) + 1);
    }
    const abortLimit = 500;
    const limited = pick(scenario, abortLimit);
    const expectedCount = [...countPerLevel.values()].reduce(
      (sum, count) => sum + Math.min(count, abortLimit),
      0,
    );
    expect([...countPerLevel.values()].some((count) => count > abortLimit)).toBe(true);
    expect(limited.priorities.size).toBe(expectedCount);
  });
});
