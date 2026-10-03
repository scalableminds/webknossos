import PriorityQueue from "js-priority-queue";
import { M4x4, type Matrix4x4 } from "libs/mjs";
import type { Vector3, Vector4 } from "viewer/constants";
import { UnitLong } from "viewer/constants";
import { _getDummyFlycamMatrix } from "viewer/model/accessors/flycam_accessor";
import determineBucketsForPlaneWithFloodFill from "viewer/model/bucket_data_handling/bucket_picker_strategies/oblique_bucket_picker";
import determineBucketsForPlaneByRows from "viewer/model/bucket_data_handling/bucket_picker_strategies/oblique_bucket_picker_rows";
import type { PlaneRects } from "viewer/store";
import { bench, describe } from "vitest";

// Compares the flood fill bucket picker with the row-based one. Each picker is measured with a
// no-op enqueue function (picking only) and with the priority queue the bucket picker worker
// uses (closer to the real cost per pick). Performance comparison only, run with
// `vitest bench --config vitest_spec.config.ts run <this file>`.

const VOXEL_SIZE: Vector3 = [11, 11, 24];
const MAGS: Vector3[] = [
  [1, 1, 1],
  [2, 2, 1],
  [4, 4, 2],
  [8, 8, 4],
  [16, 16, 8],
];
const POSITION: Vector3 = [12345.6, 9876.4, 2345.2];

function makeRects(width: number, height: number): PlaneRects {
  const rect = { width, height, top: 0, left: 0 };
  return { PLANE_XY: rect, PLANE_XZ: rect, PLANE_YZ: rect, TDView: rect };
}

// Like the matrix the layer rendering manager passes to the picker.
function makeMatrix(anglesInDegrees: Vector3, zoom: number): Matrix4x4 {
  let matrix = [..._getDummyFlycamMatrix({ factor: VOXEL_SIZE, unit: UnitLong.nm })] as Matrix4x4;
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
  matrix[12] = POSITION[0];
  matrix[13] = POSITION[1];
  matrix[14] = POSITION[2];
  return M4x4.scale1(zoom, matrix) as Matrix4x4;
}

type Scenario = {
  name: string;
  matrix: Matrix4x4;
  logZoomStep: number;
  rects: PlaneRects;
};

const FOUR_PANES = makeRects(572, 466.5);
const SCENARIOS: Scenario[] = [
  {
    name: "axis-aligned, zoom 1",
    matrix: makeMatrix([0, 0, 0], 1),
    logZoomStep: 0,
    rects: FOUR_PANES,
  },
  {
    name: "axis-aligned, zoom 1.8",
    matrix: makeMatrix([0, 0, 0], 1.8),
    logZoomStep: 0,
    rects: FOUR_PANES,
  },
  { name: "15° around x", matrix: makeMatrix([15, 0, 0], 1.3), logZoomStep: 0, rects: FOUR_PANES },
  { name: "45° around x", matrix: makeMatrix([45, 0, 0], 1.3), logZoomStep: 0, rects: FOUR_PANES },
  { name: "30°/20°/10°", matrix: makeMatrix([30, 20, 10], 1.3), logZoomStep: 0, rects: FOUR_PANES },
  {
    name: "30°/20°/10°, zoom 1.8",
    matrix: makeMatrix([30, 20, 10], 1.8),
    logZoomStep: 0,
    rects: FOUR_PANES,
  },
  {
    name: "30°/20°/10°, single maximized pane (376×376)",
    matrix: makeMatrix([30, 20, 10], 1.3),
    logZoomStep: 0,
    rects: makeRects(376, 376),
  },
  {
    name: "30°/20°/10°, mag index 1",
    matrix: makeMatrix([30, 20, 10], 2.6),
    logZoomStep: 1,
    rects: FOUR_PANES,
  },
  {
    name: "30°/20°/10°, small viewport (128×128)",
    matrix: makeMatrix([30, 20, 10], 1.3),
    logZoomStep: 0,
    rects: makeRects(128, 128),
  },
];

type PriorityItem = { bucketAddress: Vector4; priority: number };
const comparator = (b: PriorityItem, a: PriorityItem) => b.priority - a.priority;
const noopEnqueue = (_bucketAddress: Vector4, _priority: number) => {};

function pickIntoQueue(
  determineBuckets: typeof determineBucketsForPlaneWithFloodFill,
  scenario: Scenario,
) {
  const bucketQueue = new PriorityQueue<PriorityItem>({ comparator });
  determineBuckets(
    "BEST_QUALITY_FIRST",
    MAGS,
    POSITION,
    (bucketAddress, priority) => bucketQueue.queue({ bucketAddress, priority }),
    scenario.matrix,
    scenario.logZoomStep,
    scenario.rects,
  );
  return bucketQueue;
}

for (const scenario of SCENARIOS) {
  describe(`bucket picker: ${scenario.name}`, () => {
    // Logged once before the timed benchmarks run.
    const floodFillCount = pickIntoQueue(determineBucketsForPlaneWithFloodFill, scenario).length;
    const rowsCount = pickIntoQueue(determineBucketsForPlaneByRows, scenario).length;
    console.log(`  [${scenario.name}] buckets - flood fill: ${floodFillCount}, rows: ${rowsCount}`);

    const pick = (determineBuckets: typeof determineBucketsForPlaneWithFloodFill) =>
      determineBuckets(
        "BEST_QUALITY_FIRST",
        MAGS,
        POSITION,
        noopEnqueue,
        scenario.matrix,
        scenario.logZoomStep,
        scenario.rects,
      );

    bench("flood fill", () => {
      pick(determineBucketsForPlaneWithFloodFill);
    });
    bench("rows", () => {
      pick(determineBucketsForPlaneByRows);
    });
    bench("flood fill + priority queue", () => {
      pickIntoQueue(determineBucketsForPlaneWithFloodFill, scenario);
    });
    bench("rows + priority queue", () => {
      pickIntoQueue(determineBucketsForPlaneByRows, scenario);
    });
  });
}
