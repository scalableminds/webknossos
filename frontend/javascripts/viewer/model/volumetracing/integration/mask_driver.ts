/**
 * Labels a region that is already known as a whole (a MaskShape, or a list of
 * voxels) through the volume-annotation core (../core) against webKnossos' real
 * DataCube, as one transaction. For tools that compute their region up front,
 * such as volume interpolation, the trace tool and quick select.
 *
 * Like brush_driver.ts, this mutates buckets in place only and touches
 * neither the save queue nor undo.
 */

import {
  type BucketKey,
  bucketAddressOfVoxel,
  bucketKey,
  type EditContext,
  type OverwriteMode,
  type SegmentId,
  type Vector3,
  voxelIndexOf,
  voxelOffsetInBucket,
} from "../core/volume_annotation_types";
import type { MaskShape } from "../core/volume_edit_intents";
import { type BucketWriter, VolumeTransaction } from "../core/volume_transaction";
import { rasterize } from "../core/voxel_rasterizer";
import type { DriverOptions, DriverResult } from "./tool_driver_types";
import { magListForCube, WkDataCubeAdapter } from "./wk_data_cube_adapter";

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
  return runEdit(options, toolName, (transaction, ctx) => rasterize(mask, ctx, transaction));
}

/**
 * Labels the given voxels, in source-mag voxel coordinates, overwriting whatever
 * they hold. For api.data.labelVoxels.
 */
export function runVoxelsEdit(
  options: DriverOptions,
  voxels: Vector3[],
  toolName: string,
): DriverResult {
  const maskOptions: MaskDriverOptions = {
    ...options,
    overwriteMode: "overwrite-all",
    overwritableValue: 0n,
  };
  return runEdit(maskOptions, toolName, (transaction) => {
    // One write cursor per bucket, as the rasterizer does.
    const writers = new Map<BucketKey, BucketWriter>();
    for (const voxel of voxels) {
      const address = bucketAddressOfVoxel(voxel, options.magIndex, options.additionalCoordinates);
      const key = bucketKey(address);
      let writer = writers.get(key);
      if (writer == null) {
        writer = transaction.writerFor(address, options.segmentId);
        writers.set(key, writer);
      }
      const [x, y, z] = voxelOffsetInBucket(voxel);
      writer.mark(voxelIndexOf(x, y, z));
    }
  });
}

function runEdit(
  options: MaskDriverOptions,
  toolName: string,
  record: (transaction: VolumeTransaction, ctx: EditContext) => void,
): DriverResult {
  const startedAt = performance.now();
  const adapter = new WkDataCubeAdapter(options.cube, options.saveMode);
  const ctx: EditContext = {
    sourceMagIndex: options.magIndex,
    activeSegmentId: options.segmentId,
    overwriteMode: options.overwriteMode,
    overwritableValue: options.overwritableValue,
    additionalCoordinates: options.additionalCoordinates,
  };
  const transaction = new VolumeTransaction(
    `${toolName}-${Date.now()}`,
    ctx,
    adapter,
    magListForCube(options.cube),
  );

  record(transaction, ctx);
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
    bucketDiffs: diff.bucketDiffs,
    mags: [...new Set(diff.bucketDiffs.map((d) => d.address[3]))].sort((a, b) => a - b),
    durationMs: performance.now() - startedAt,
  };
}
