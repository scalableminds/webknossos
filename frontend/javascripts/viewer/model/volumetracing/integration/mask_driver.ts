/**
 * Labels a region that is already known as a whole (a MaskShape) through the
 * volume-annotation core (../core) against webKnossos' real DataCube, as one
 * transaction. For tools that compute their region up front, such as volume
 * interpolation.
 *
 * Like brush_driver.ts, this mutates buckets in place only and touches
 * neither the save queue nor undo.
 */

import type { EditContext, OverwriteMode, SegmentId } from "../core/volume_annotation_types";
import type { MaskShape } from "../core/volume_edit_intents";
import { VolumeTransaction } from "../core/volume_transaction";
import { rasterize } from "../core/voxel_rasterizer";
import type { DriverOptions, DriverResult } from "./tool_driver_types";
import { magListFromDenseMags, WkDataCubeAdapter } from "./wk_data_cube_adapter";

export interface MaskDriverOptions extends DriverOptions {
  overwriteMode: OverwriteMode;
  /** See EditContext.overwritableValue. */
  overwritableValue: SegmentId;
}

export function runMaskEdit(
  options: MaskDriverOptions,
  mask: MaskShape,
  toolName: string,
): DriverResult {
  const startedAt = performance.now();
  const adapter = new WkDataCubeAdapter(options.cube);
  const ctx: EditContext = {
    sourceMagIndex: options.magIndex,
    activeSegmentId: options.segmentId,
    overwriteMode: options.overwriteMode,
    overwritableValue: options.overwritableValue,
    editableBoundingBox: null,
    additionalCoordinates: options.additionalCoordinates,
  };
  const transaction = new VolumeTransaction(
    `${toolName}-${Date.now()}`,
    ctx,
    adapter,
    magListFromDenseMags(options.denseMags),
  );

  rasterize(mask, ctx, transaction);
  // Writes the source mag and every propagated mag to the cube.
  const diff = transaction.commit(0, toolName);
  adapter.flush();

  let voxels = 0;
  for (const bucketDiff of diff.bucketDiffs) {
    for (const run of bucketDiff.runs) voxels += run.length;
  }
  return {
    voxels,
    buckets: diff.bucketDiffs.length,
    mags: [...new Set(diff.bucketDiffs.map((d) => d.address[3]))].sort((a, b) => a - b),
    durationMs: performance.now() - startedAt,
  };
}
