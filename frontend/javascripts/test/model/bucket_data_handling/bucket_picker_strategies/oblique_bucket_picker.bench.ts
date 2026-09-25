import { M4x4 } from "libs/mjs";
import type { Matrix4x4 } from "mjs";
import type { Vector3, Vector4 } from "viewer/constants";
import { Identity4x4 } from "viewer/constants";
import determineBucketsForPlaneWithScanLines from "viewer/model/bucket_data_handling/bucket_picker_strategies/oblique_bucket_picker";
import determineBucketsForPlaneWithFloodFill from "viewer/model/bucket_data_handling/bucket_picker_strategies/oblique_bucket_picker_flood_fill";
import determineBucketsForPlaneWithFloodFillWasm from "viewer/model/bucket_data_handling/bucket_picker_strategies/oblique_bucket_picker_flood_fill_wasm";
import determineBucketsForPlaneOriginal from "viewer/model/bucket_data_handling/bucket_picker_strategies/oblique_bucket_picker_original";
import determineBucketsForPlaneWithWasm from "viewer/model/bucket_data_handling/bucket_picker_strategies/oblique_bucket_picker_wasm";
import type { LoadingStrategy, PlaneRects } from "viewer/store";
import { beforeAll, bench, describe } from "vitest";

// Compares the oblique bucket picker strategies developed in this branch (scan lines, flood
// fill, and C/WASM(SIMD) ports of both -- see oblique_bucket_picker.ts /
// oblique_bucket_picker_flood_fill.ts / oblique_bucket_picker_wasm.ts /
// oblique_bucket_picker_flood_fill_wasm.ts) against oblique_bucket_picker_original.ts, a frozen
// copy of the picker exactly as it was on master before this branch, across a number of
// rotation/zoom/viewport scenarios.
//
// The master version always did prefetching (extra buckets picked slightly in front of/behind
// the plane, simulating the flycam moving along its view axis -- see PREFETCH_Z_DIFF / zDiff),
// which this branch initially disabled to keep the scan-line/flood-fill comparison apples to
// apples, then reintroduced behind the prefetchAlongViewAxis flag (implemented for all four
// strategies, JS and wasm alike). So each of the four strategies is benchmarked twice: once
// matching the rest of this comparison (prefetch off) and once matching what "original
// (master)" actually does (prefetch on), so the master comparison is also apples to apples.
//
// This is a performance comparison, not a correctness check -- there are intentionally no
// assertions (see oblique_bucket_picker_wasm.spec.ts / oblique_bucket_picker_flood_fill_wasm.spec.ts
// for the correctness checks that each wasm port matches its JS counterpart exactly). Run with
// `yarn test-bench`.

const LOADING_STRATEGY: LoadingStrategy = "BEST_QUALITY_FIRST";
const POSITION: Vector3 = [1223, 3218, 518];

const ISOTROPIC_MAGS: Vector3[] = [
  [1, 1, 1],
  [2, 2, 2],
  [4, 4, 4],
  [8, 8, 8],
  [16, 16, 16],
];

// Anisotropic mags (typical for datasets with lower z resolution) stress the shear case:
// a rotation combined with non-uniform per-axis bucket sizes.
const ANISOTROPIC_MAGS: Vector3[] = [
  [1, 1, 1],
  [2, 2, 1],
  [4, 4, 1],
  [8, 8, 2],
  [16, 16, 4],
  [32, 32, 8],
];

function makeRects(size: number): PlaneRects {
  const rect = { width: size, height: size, top: 0, left: 0 };
  return { PLANE_XY: rect, PLANE_YZ: rect, PLANE_XZ: rect, TDView: rect };
}

// Builds a rotation matrix (degrees, applied x then y then z) whose translation is fixed to
// POSITION, mirroring a real flycam matrix (rotation around the camera, translated to the
// camera's position). Directly patching in the translation columns (rather than using
// M4x4.translate, which translates in local space) guarantees the plane's local origin is
// exactly POSITION, regardless of the rotation applied.
function makeMatrix(angleXDeg: number, angleYDeg: number, angleZDeg: number): Matrix4x4 {
  const toRad = (deg: number) => (deg / 180) * Math.PI;
  let matrix = Identity4x4;
  if (angleXDeg !== 0) matrix = M4x4.rotate(toRad(angleXDeg), [1, 0, 0], matrix, []);
  if (angleYDeg !== 0) matrix = M4x4.rotate(toRad(angleYDeg), [0, 1, 0], matrix, []);
  if (angleZDeg !== 0) matrix = M4x4.rotate(toRad(angleZDeg), [0, 0, 1], matrix, []);
  const result = [...matrix] as Matrix4x4;
  result[12] = POSITION[0];
  result[13] = POSITION[1];
  result[14] = POSITION[2];
  return result;
}

type Scenario = {
  name: string;
  matrix: Matrix4x4;
  denseMags: Vector3[];
  logZoomStep: number;
  rects: PlaneRects;
};

const SCENARIOS: Scenario[] = [
  {
    name: "axis-aligned",
    matrix: makeMatrix(0, 0, 0),
    denseMags: ISOTROPIC_MAGS,
    logZoomStep: 0,
    rects: makeRects(384),
  },
  {
    name: "15° tilt around x",
    matrix: makeMatrix(15, 0, 0),
    denseMags: ISOTROPIC_MAGS,
    logZoomStep: 0,
    rects: makeRects(384),
  },
  {
    name: "45° tilt around x (worst case for a single scan direction)",
    matrix: makeMatrix(45, 0, 0),
    denseMags: ISOTROPIC_MAGS,
    logZoomStep: 0,
    rects: makeRects(384),
  },
  {
    name: "compound tilt (30x/20y/10z), typical oblique view",
    matrix: makeMatrix(30, 20, 10),
    denseMags: ISOTROPIC_MAGS,
    logZoomStep: 0,
    rects: makeRects(384),
  },
  {
    name: "compound tilt (30x/20y/10z), coarser mag (mag index 2)",
    matrix: makeMatrix(30, 20, 10),
    denseMags: ISOTROPIC_MAGS,
    logZoomStep: 2,
    rects: makeRects(384),
  },
  {
    name: "compound tilt (30x/20y/10z), small viewport (128px)",
    matrix: makeMatrix(30, 20, 10),
    denseMags: ISOTROPIC_MAGS,
    logZoomStep: 0,
    rects: makeRects(128),
  },
  {
    name: "compound tilt (30x/20y/10z), large viewport (768px)",
    matrix: makeMatrix(30, 20, 10),
    denseMags: ISOTROPIC_MAGS,
    logZoomStep: 0,
    rects: makeRects(768),
  },
  {
    name: "compound tilt (30x/20y/10z), anisotropic mags",
    matrix: makeMatrix(30, 20, 10),
    denseMags: ANISOTROPIC_MAGS,
    logZoomStep: 0,
    rects: makeRects(384),
  },
];

async function countBuckets(
  determineBucketsForPlane:
    | typeof determineBucketsForPlaneWithScanLines
    | typeof determineBucketsForPlaneWithWasm
    | typeof determineBucketsForPlaneWithFloodFillWasm
    | typeof determineBucketsForPlaneOriginal,
  scenario: Scenario,
  prefetchAlongViewAxis?: boolean,
): Promise<number> {
  let count = 0;
  const enqueueFunction = (_bucketAddress: Vector4, _priority: number) => {
    count++;
  };
  // wasm's determineBucketsForPlane is async (see oblique_bucket_picker_wasm.ts); awaiting the
  // scan-line/flood-fill pickers' plain (non-promise) return value is a no-op.
  await determineBucketsForPlane(
    LOADING_STRATEGY,
    scenario.denseMags,
    POSITION,
    enqueueFunction,
    scenario.matrix,
    scenario.logZoomStep,
    scenario.rects,
    undefined,
    undefined,
    prefetchAlongViewAxis,
  );
  return count;
}

const noopEnqueue = (_bucketAddress: Vector4, _priority: number) => {};

for (const scenario of SCENARIOS) {
  describe(`oblique bucket picker: ${scenario.name}`, () => {
    // Logged once before the timed benchmarks run, to give some context on how many buckets
    // each strategy actually picks for this scenario. Wrapped in beforeAll() (rather than
    // computed directly in this describe callback) since determineBucketsForPlaneWithWasm is
    // async, and describe() callbacks themselves can't be.
    beforeAll(async () => {
      const scanLineCount = await countBuckets(determineBucketsForPlaneWithScanLines, scenario);
      const floodFillCount = await countBuckets(determineBucketsForPlaneWithFloodFill, scenario);
      const wasmCount = await countBuckets(determineBucketsForPlaneWithWasm, scenario);
      const floodFillWasmCount = await countBuckets(
        determineBucketsForPlaneWithFloodFillWasm,
        scenario,
      );
      const scanLinePrefetchCount = await countBuckets(
        determineBucketsForPlaneWithScanLines,
        scenario,
        true,
      );
      const floodFillPrefetchCount = await countBuckets(
        determineBucketsForPlaneWithFloodFill,
        scenario,
        true,
      );
      const wasmPrefetchCount = await countBuckets(
        determineBucketsForPlaneWithWasm,
        scenario,
        true,
      );
      const floodFillWasmPrefetchCount = await countBuckets(
        determineBucketsForPlaneWithFloodFillWasm,
        scenario,
        true,
      );
      const originalCount = await countBuckets(determineBucketsForPlaneOriginal, scenario);
      console.log(
        `  [${scenario.name}] buckets picked - scanLines: ${scanLineCount}, floodFill: ${floodFillCount}, ` +
          `wasm: ${wasmCount}, floodFillWasm: ${floodFillWasmCount}, ` +
          `scanLines+prefetch: ${scanLinePrefetchCount}, floodFill+prefetch: ${floodFillPrefetchCount}, ` +
          `wasm+prefetch: ${wasmPrefetchCount}, floodFillWasm+prefetch: ${floodFillWasmPrefetchCount}, ` +
          `original (master): ${originalCount}`,
      );
    });

    bench("scan lines", () => {
      determineBucketsForPlaneWithScanLines(
        LOADING_STRATEGY,
        scenario.denseMags,
        POSITION,
        noopEnqueue,
        scenario.matrix,
        scenario.logZoomStep,
        scenario.rects,
      );
    });

    bench("flood fill", () => {
      determineBucketsForPlaneWithFloodFill(
        LOADING_STRATEGY,
        scenario.denseMags,
        POSITION,
        noopEnqueue,
        scenario.matrix,
        scenario.logZoomStep,
        scenario.rects,
      );
    });

    bench("wasm (scan lines, C/SIMD)", async () => {
      await determineBucketsForPlaneWithWasm(
        LOADING_STRATEGY,
        scenario.denseMags,
        POSITION,
        noopEnqueue,
        scenario.matrix,
        scenario.logZoomStep,
        scenario.rects,
      );
    });

    bench("wasm (flood fill, C/SIMD)", async () => {
      await determineBucketsForPlaneWithFloodFillWasm(
        LOADING_STRATEGY,
        scenario.denseMags,
        POSITION,
        noopEnqueue,
        scenario.matrix,
        scenario.logZoomStep,
        scenario.rects,
      );
    });

    // These two match what "original (master)" below actually does (prefetch always on), so
    // that comparison is also apples to apples -- see the module comment above.
    bench("scan lines + prefetch", () => {
      determineBucketsForPlaneWithScanLines(
        LOADING_STRATEGY,
        scenario.denseMags,
        POSITION,
        noopEnqueue,
        scenario.matrix,
        scenario.logZoomStep,
        scenario.rects,
        undefined,
        undefined,
        true,
      );
    });

    bench("flood fill + prefetch", () => {
      determineBucketsForPlaneWithFloodFill(
        LOADING_STRATEGY,
        scenario.denseMags,
        POSITION,
        noopEnqueue,
        scenario.matrix,
        scenario.logZoomStep,
        scenario.rects,
        undefined,
        undefined,
        true,
      );
    });

    bench("wasm (scan lines, C/SIMD) + prefetch", async () => {
      await determineBucketsForPlaneWithWasm(
        LOADING_STRATEGY,
        scenario.denseMags,
        POSITION,
        noopEnqueue,
        scenario.matrix,
        scenario.logZoomStep,
        scenario.rects,
        undefined,
        undefined,
        true,
      );
    });

    bench("wasm (flood fill, C/SIMD) + prefetch", async () => {
      await determineBucketsForPlaneWithFloodFillWasm(
        LOADING_STRATEGY,
        scenario.denseMags,
        POSITION,
        noopEnqueue,
        scenario.matrix,
        scenario.logZoomStep,
        scenario.rects,
        undefined,
        undefined,
        true,
      );
    });

    bench("original (master)", () => {
      determineBucketsForPlaneOriginal(
        LOADING_STRATEGY,
        scenario.denseMags,
        POSITION,
        noopEnqueue,
        scenario.matrix,
        scenario.logZoomStep,
        scenario.rects,
      );
    });
  });
}
