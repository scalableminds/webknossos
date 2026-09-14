import { M4x4 } from "libs/mjs";
import type { Matrix4x4 } from "mjs";
import type { Vector3, Vector4 } from "viewer/constants";
import { Identity4x4 } from "viewer/constants";
import determineBucketsForPlaneWithScanLines from "viewer/model/bucket_data_handling/bucket_picker_strategies/oblique_bucket_picker";
import determineBucketsForPlaneWithFloodFill from "viewer/model/bucket_data_handling/bucket_picker_strategies/oblique_bucket_picker_flood_fill";
import type { LoadingStrategy, PlaneRects } from "viewer/store";
import { bench, describe } from "vitest";

// Compares the two oblique bucket picker strategies (scan lines vs. flood fill, see
// oblique_bucket_picker.ts / oblique_bucket_picker_flood_fill.ts) across a number of
// rotation/zoom/viewport scenarios. This is a performance comparison, not a correctness
// check -- there are intentionally no assertions. Run with `yarn test-bench`.

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

function countBuckets(
  determineBucketsForPlane: typeof determineBucketsForPlaneWithScanLines,
  scenario: Scenario,
): number {
  let count = 0;
  const enqueueFunction = (_bucketAddress: Vector4, _priority: number) => {
    count++;
  };
  determineBucketsForPlane(
    LOADING_STRATEGY,
    scenario.denseMags,
    POSITION,
    enqueueFunction,
    scenario.matrix,
    scenario.logZoomStep,
    scenario.rects,
  );
  return count;
}

const noopEnqueue = (_bucketAddress: Vector4, _priority: number) => {};

for (const scenario of SCENARIOS) {
  describe(`oblique bucket picker: ${scenario.name}`, () => {
    // Logged once during collection (not part of the timed benchmark) to give some context
    // on how many buckets each strategy actually picks for this scenario.
    const scanLineCount = countBuckets(determineBucketsForPlaneWithScanLines, scenario);
    const floodFillCount = countBuckets(determineBucketsForPlaneWithFloodFill, scenario);
    console.log(
      `  [${scenario.name}] buckets picked - scanLines: ${scanLineCount}, floodFill: ${floodFillCount}`,
    );

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
  });
}
