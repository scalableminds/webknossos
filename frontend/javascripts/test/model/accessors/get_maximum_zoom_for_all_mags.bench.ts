import type { Matrix4x4 } from "mjs";
import type { OrthoViewRects, Vector3, ViewMode } from "viewer/constants";
import constants from "viewer/constants";
import { _getMaximumZoomForAllMags } from "viewer/model/accessors/flycam_accessor";
import type { LoadingStrategy } from "viewer/store";
import { bench, describe } from "vitest";

// Benchmarks _getMaximumZoomForAllMags (the function underlying
// async_get_maximum_zoom_for_all_mags.worker.ts / the "getMaximumZoomForAllMags" console.time
// a user measured in production) with real captured production parameters, rather than the
// single-pick synthetic scenarios in oblique_bucket_picker.bench.ts.
//
// This is a meaningfully different workload than that other benchmark: _getMaximumZoomForAllMags
// loops internally over dozens of synthetic zoom levels (searching for the zoom threshold of
// each mag), and every one of those inner picks is abort-limited to `maximumCapacity + 1`
// buckets -- so most individual picks are much cheaper/more truncated than the large,
// uncapped single picks benchmarked elsewhere. This is meant to explain (or refute) a
// real-world observation that switching strategies didn't produce the ~3x speedup seen in the
// single-pick benchmarks.
//
// This is a performance comparison, not a correctness check -- there are intentionally no
// assertions. Run with `yarn test-bench`.

const VOXEL_SIZE_FACTOR: Vector3 = [11, 11, 24];
const MAGS: Vector3[] = [
  [1, 1, 1],
  [2, 2, 1],
  [4, 4, 2],
  [8, 8, 4],
  [16, 16, 8],
];
const MAXIMUM_CAPACITY = 2048;
const LAYER_MATRIX: Matrix4x4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
// 180° rotation around z (cos(pi) approx -1, sin(pi) approx 1.2246e-16) with a 0.4583 z-scale,
// captured verbatim from a real session.
const FLYCAM_MATRIX: Matrix4x4 = [
  -1, 1.2246467991473532e-16, 0, 0, -1.2246467991473532e-16, -1, 0, 0, 0, 0, 0.4583333333333333, 0,
  0, 0, 0, 1,
];
const VIEW_MODE: ViewMode = "orthogonal";
const LOADING_STRATEGY: LoadingStrategy = "PROGRESSIVE_QUALITY";

// Captured while only a single viewport pane was visible/maximized: all four "planes" (the
// oblique bucket picker only actually uses PLANE_XY/XZ/YZ, not TDView) get the same square rect.
const SINGLE_PANE_RECTS: OrthoViewRects = {
  PLANE_XY: { top: 0, left: 0, width: 376, height: 376 },
  PLANE_YZ: { top: 0, left: 0, width: 376, height: 376 },
  PLANE_XZ: { top: 0, left: 0, width: 376, height: 376 },
  TDView: { top: 0, left: 0, width: 376, height: 376 },
};

// Captured in the standard 4-pane layout: each viewport is a distinct, non-square rect.
const FOUR_PANE_RECTS: OrthoViewRects = {
  PLANE_XY: { left: 368, top: 24, width: 572, height: 466.5 },
  PLANE_YZ: { left: 945, top: 24, width: 572, height: 466.5 },
  PLANE_XZ: { left: 368, top: 517.5, width: 572, height: 466.5 },
  TDView: { left: 945, top: 517.5, width: 572, height: 466.5 },
};

type Scenario = {
  name: string;
  rects: OrthoViewRects;
};

const SCENARIOS: Scenario[] = [
  { name: "single maximized pane (376x376 square)", rects: SINGLE_PANE_RECTS },
  { name: "standard 4-pane layout (572x466.5)", rects: FOUR_PANE_RECTS },
];

const STRATEGIES: Array<"scanLines" | "floodFill" | "wasm" | "floodFillWasm"> = [
  "scanLines",
  "floodFill",
  "wasm",
  "floodFillWasm",
];

for (const scenario of SCENARIOS) {
  describe(`getMaximumZoomForAllMags: ${scenario.name}`, () => {
    for (const strategy of STRATEGIES) {
      bench(strategy, async () => {
        await _getMaximumZoomForAllMags(
          VIEW_MODE,
          LOADING_STRATEGY,
          VOXEL_SIZE_FACTOR,
          MAGS,
          scenario.rects,
          MAXIMUM_CAPACITY,
          LAYER_MATRIX,
          FLYCAM_MATRIX,
          strategy,
          // Matches the captured production parameters (prefetchAlongViewAxis: true).
          true,
        );
      });
    }
  });
}
