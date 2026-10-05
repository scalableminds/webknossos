import type { Matrix4x4 } from "mjs";
import type { OrthoViewRects, Vector3, ViewMode } from "viewer/constants";
import constants from "viewer/constants";
import { _getMaximumZoomForAllMags } from "viewer/model/accessors/flycam_accessor";
import determineBucketsForPlaneWithFloodFill from "viewer/model/bucket_data_handling/bucket_picker_strategies/legacy/oblique_bucket_picker_flood_fill";
import determineBucketsForPlaneWithScanLines from "viewer/model/bucket_data_handling/bucket_picker_strategies/legacy/oblique_bucket_picker_scan_lines";
import determineBucketsForPlane from "viewer/model/bucket_data_handling/bucket_picker_strategies/oblique_bucket_picker";
import type { LoadingStrategy } from "viewer/store";
import { expose } from "./comlink_core";

// TEMPORARY (revert before merging): dev-only comparison of the oblique bucket pickers, see
// WkDevFlags.bucketDebugging.compareObliquePickers. The first variant's result is returned.
const COMPARISON_VARIANTS: Array<{ name: string; picker: typeof determineBucketsForPlane }> = [
  { name: "rows (new)", picker: determineBucketsForPlane },
  { name: "flood fill (#10010)", picker: determineBucketsForPlaneWithFloodFill },
  { name: "scan lines (master)", picker: determineBucketsForPlaneWithScanLines },
];
const comparisonDurations = COMPARISON_VARIANTS.map(() => [] as number[]);
let comparisonCount = 0;

function asyncGetMaximumZoomForAllMags(
  viewMode: ViewMode,
  loadingStrategy: LoadingStrategy,
  voxelSizeFactor: Vector3,
  mags: Array<Vector3>,
  viewportRects: OrthoViewRects,
  maximumCapacity: number,
  layerMatrix: Matrix4x4,
  flycamMatrix: Matrix4x4,
  compareObliquePickers?: boolean,
) {
  const compute = (picker: typeof determineBucketsForPlane) =>
    _getMaximumZoomForAllMags(
      viewMode,
      loadingStrategy,
      voxelSizeFactor,
      mags,
      viewportRects,
      maximumCapacity,
      layerMatrix,
      flycamMatrix,
      picker,
    );
  if (!compareObliquePickers || viewMode === constants.MODE_FLIGHT) {
    return compute(determineBucketsForPlane);
  }

  const results: number[][] = [];
  const durations: number[] = [];
  // Rotate the order, so that no variant systematically profits from running first or last.
  for (let i = 0; i < COMPARISON_VARIANTS.length; i++) {
    const variantIndex = (comparisonCount + i) % COMPARISON_VARIANTS.length;
    const startTime = performance.now();
    results[variantIndex] = compute(COMPARISON_VARIANTS[variantIndex].picker);
    durations[variantIndex] = performance.now() - startTime;
    comparisonDurations[variantIndex].push(durations[variantIndex]);
  }
  comparisonCount++;

  const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;
  const newThresholds = JSON.stringify(results[0]);
  console.log(
    `[getMaximumZoomForAllMags] call ${comparisonCount}: ` +
      COMPARISON_VARIANTS.map(
        ({ name }, i) =>
          `${name} ${durations[i].toFixed(2)} ms (mean ${mean(comparisonDurations[i]).toFixed(2)} ms)`,
      ).join(", ") +
      ". Thresholds identical to rows: " +
      COMPARISON_VARIANTS.slice(1)
        .map(
          ({ name }, i) =>
            `${name} ${JSON.stringify(results[i + 1]) === newThresholds ? "yes" : "no"}`,
        )
        .join(", "),
  );
  return results[0];
}

export default expose(asyncGetMaximumZoomForAllMags);
