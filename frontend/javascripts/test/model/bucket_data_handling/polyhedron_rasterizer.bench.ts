import { M4x4, type Matrix4x4 } from "libs/mjs";
import type { Vector3 } from "viewer/constants";
import collectBucketsInConvexPolyhedron, {
  buildOverlapTest,
  collectBucketsInConvexPolyhedronByRows,
} from "viewer/model/bucket_data_handling/polyhedron_flood_fill";
import PolyhedronRasterizer from "viewer/model/bucket_data_handling/polyhedron_rasterizer";
import { test } from "vitest";

// Compares PolyhedronRasterizer (as used by PrefetchStrategyFlight) with a flood fill over the
// buckets that overlap the same polyhedron. Performance comparison only, run with
// `vitest bench --config vitest_spec.config.ts --reporter=verbose run <this file>`.

type Scenario = {
  name: string;
  frustum: [number, number, number, number, number, number];
  rotation: Vector3;
  voxelSize: Vector3;
};

const DEFAULT_FRUSTUM: Scenario["frustum"] = [7, 7, -0.5, 10, 10, 20];

const SCENARIOS: Scenario[] = [
  {
    name: "default orientation",
    frustum: DEFAULT_FRUSTUM,
    rotation: [0, 0, 0],
    voxelSize: [1, 1, 1],
  },
  {
    name: "rotated (30°/20°/10°)",
    frustum: DEFAULT_FRUSTUM,
    rotation: [30, 20, 10],
    voxelSize: [1, 1, 1],
  },
  {
    name: "rotated 45° around x",
    frustum: DEFAULT_FRUSTUM,
    rotation: [45, 0, 0],
    voxelSize: [1, 1, 1],
  },
  {
    name: "rotated (30°/20°/10°), voxel size 11×11×24",
    frustum: DEFAULT_FRUSTUM,
    rotation: [30, 20, 10],
    voxelSize: [11, 11, 24],
  },
  {
    name: "rotated (30°/20°/10°), 2x larger frustum",
    frustum: [14, 14, -1, 20, 20, 40],
    rotation: [30, 20, 10],
    voxelSize: [1, 1, 1],
  },
];

const POSITION: Vector3 = [5000, 4000, 3000];
const ZOOM_STEP = 0;

// Mirrors flycam.currentMatrix: scaled by the base voxel factors, rotated by 180° around z (the
// default flycam orientation), then by the scenario's rotation, translated to the position.
function getFlycamMatrix(scenario: Scenario): Matrix4x4 {
  const baseVoxel = Math.min(...scenario.voxelSize);
  const scale = scenario.voxelSize.map((size) => baseVoxel / size) as Vector3;
  const toRad = (deg: number) => (deg / 180) * Math.PI;
  let matrix = M4x4.rotate(Math.PI, [0, 0, 1], M4x4.scale(scale, M4x4.identity(), []), []);
  matrix = M4x4.rotate(toRad(scenario.rotation[0]), [1, 0, 0], matrix, []);
  matrix = M4x4.rotate(toRad(scenario.rotation[1]), [0, 1, 0], matrix, []);
  matrix = M4x4.rotate(toRad(scenario.rotation[2]), [0, 0, 1], matrix, []) as Matrix4x4;
  matrix[12] = POSITION[0];
  matrix[13] = POSITION[1];
  matrix[14] = POSITION[2];
  return matrix;
}

// Same as PrefetchStrategyFlight.modifyMatrixForPoly: converts the translation to bucket coordinates.
function toBucketMatrix(matrix: Matrix4x4): Matrix4x4 {
  const result = M4x4.clone(matrix);
  result[12] = (result[12] >> (5 + ZOOM_STEP)) + 1;
  result[13] = (result[13] >> (5 + ZOOM_STEP)) + 1;
  result[14] = (result[14] >> (5 + ZOOM_STEP)) + 1;
  return result;
}

function toKeys(points: ArrayLike<number>): Set<string> {
  const keys = new Set<string>();
  for (let i = 0; i < points.length; i += 3) {
    keys.add(`${points[i]},${points[i + 1]},${points[i + 2]}`);
  }
  return keys;
}

for (const scenario of SCENARIOS) {
  const master = PolyhedronRasterizer.Master.squareFrustum(...scenario.frustum);
  const matrix = toBucketMatrix(getFlycamMatrix(scenario));

  const rasterize = () =>
    master.transformAffine(matrix).collectPointsOnion(matrix[12], matrix[13], matrix[14]);
  const floodFill = () =>
    collectBucketsInConvexPolyhedron(
      M4x4.transformPointsAffine(matrix, master.vertices),
      master.indices,
    );
  const rows = () =>
    collectBucketsInConvexPolyhedronByRows(
      M4x4.transformPointsAffine(matrix, master.vertices),
      master.indices,
    );

  test(`polyhedron buckets: ${scenario.name}`, { timeout: 60000 }, async ({ bench }) => {
    // Logged once before the timed benchmarks run.
    const rasterized = toKeys(rasterize());
    const floodFilled = toKeys(floodFill());
    const byRows = toKeys(rows());
    const rowsMatchFloodFill =
      byRows.size === floodFilled.size && [...byRows].every((key) => floodFilled.has(key));
    const overlaps = buildOverlapTest(
      M4x4.transformPointsAffine(matrix, master.vertices),
      master.indices,
    );
    const rasterizedNotOverlapping = [...rasterized].filter((key) => {
      const [x, y, z] = key.split(",").map(Number);
      return !overlaps(x, y, z);
    }).length;
    const missedByRasterizer = [...floodFilled].filter((key) => !rasterized.has(key)).length;
    console.log(
      `  [${scenario.name}] buckets - rasterizer: ${rasterized.size}, flood fill: ${floodFilled.size}, ` +
        `rasterized but not overlapping: ${rasterizedNotOverlapping}, overlapping but not rasterized: ${missedByRasterizer}, ` +
        `rows: ${byRows.size} (${rowsMatchFloodFill ? "same as" : "DIFFERENT FROM"} flood fill)`,
    );

    await bench.compare(
      bench("rasterizer", () => {
        rasterize();
      }),
      bench("flood fill", () => {
        floodFill();
      }),
      bench("rows", () => {
        rows();
      }),
      { time: 500 },
    );
  });
}
