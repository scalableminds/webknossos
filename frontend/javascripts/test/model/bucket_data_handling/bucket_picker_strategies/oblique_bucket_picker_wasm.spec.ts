import { M4x4 } from "libs/mjs";
import type { Matrix4x4 } from "mjs";
import type { Vector3, Vector4 } from "viewer/constants";
import { Identity4x4 } from "viewer/constants";
import determineBucketsForPlaneWithScanLines from "viewer/model/bucket_data_handling/bucket_picker_strategies/oblique_bucket_picker";
import determineBucketsForPlaneWithWasm from "viewer/model/bucket_data_handling/bucket_picker_strategies/oblique_bucket_picker_wasm";
import type { LoadingStrategy, PlaneRects } from "viewer/store";
import { describe, expect, it } from "vitest";

// Verifies that the WASM port (oblique_bucket_picker_wasm.ts / oblique_bucket_picker.c)
// produces exactly the same buckets (and priorities) as the original TypeScript scan-line
// picker it's a port of, across a range of rotation/zoom/viewport scenarios.

const LOADING_STRATEGY: LoadingStrategy = "BEST_QUALITY_FIRST";
const POSITION: Vector3 = [1223, 3218, 518];

const ISOTROPIC_MAGS: Vector3[] = [
  [1, 1, 1],
  [2, 2, 2],
  [4, 4, 4],
  [8, 8, 8],
  [16, 16, 16],
];
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
    name: "45° tilt around x",
    matrix: makeMatrix(45, 0, 0),
    denseMags: ISOTROPIC_MAGS,
    logZoomStep: 0,
    rects: makeRects(384),
  },
  {
    name: "compound tilt (30x/20y/10z)",
    matrix: makeMatrix(30, 20, 10),
    denseMags: ISOTROPIC_MAGS,
    logZoomStep: 0,
    rects: makeRects(384),
  },
  {
    name: "compound tilt, coarser mag (mag index 2)",
    matrix: makeMatrix(30, 20, 10),
    denseMags: ISOTROPIC_MAGS,
    logZoomStep: 2,
    rects: makeRects(384),
  },
  {
    name: "compound tilt, small viewport (128px)",
    matrix: makeMatrix(30, 20, 10),
    denseMags: ISOTROPIC_MAGS,
    logZoomStep: 0,
    rects: makeRects(128),
  },
  {
    name: "compound tilt, large viewport (768px)",
    matrix: makeMatrix(30, 20, 10),
    denseMags: ISOTROPIC_MAGS,
    logZoomStep: 0,
    rects: makeRects(768),
  },
  {
    name: "compound tilt, anisotropic mags",
    matrix: makeMatrix(30, 20, 10),
    denseMags: ANISOTROPIC_MAGS,
    logZoomStep: 0,
    rects: makeRects(384),
  },
];

async function collect(
  determineBucketsForPlane:
    | typeof determineBucketsForPlaneWithScanLines
    | typeof determineBucketsForPlaneWithWasm,
  scenario: Scenario,
): Promise<Array<[number, number, number, number, number]>> {
  const results: Array<[number, number, number, number, number]> = [];
  const enqueueFunction = (bucketAddress: Vector4, priority: number) => {
    results.push([
      bucketAddress[0],
      bucketAddress[1],
      bucketAddress[2],
      bucketAddress[3],
      priority,
    ]);
  };
  // wasm's determineBucketsForPlane is async (see oblique_bucket_picker_wasm.ts); awaiting the
  // scan-line picker's plain (non-promise) return value is a no-op.
  await determineBucketsForPlane(
    LOADING_STRATEGY,
    scenario.denseMags,
    POSITION,
    enqueueFunction,
    scenario.matrix,
    scenario.logZoomStep,
    scenario.rects,
  );
  const key = (r: Array<number>) => r.join(",");
  return results.sort((a, b) => (key(a) < key(b) ? -1 : 1));
}

describe("oblique_bucket_picker_wasm", () => {
  for (const scenario of SCENARIOS) {
    it(`matches the scan-line picker for: ${scenario.name}`, async () => {
      const scanLineResults = await collect(determineBucketsForPlaneWithScanLines, scenario);
      const wasmResults = await collect(determineBucketsForPlaneWithWasm, scenario);
      expect(wasmResults).toEqual(scanLineResults);
    });
  }
});
