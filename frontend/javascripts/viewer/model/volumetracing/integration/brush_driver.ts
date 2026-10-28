/**
 * Drives a brush stroke through the volume-annotation core (../core) against
 * webKnossos' real DataCube.
 *
 * `editVolumeLayerAsync` (viewer/model/sagas/volumetracing_saga.tsx) owns the
 * event loop (START_EDITING / ADD_TO_CONTOUR_LIST / FINISH_EDITING); this owns
 * everything between. The driver itself emits no update actions: it mutates
 * buckets in place and returns the committed bucket diffs. Depending on the
 * SaveMode, the buckets are saved whole via the push queue, or the saga turns
 * the diffs into `updateBucketPartial` update actions.
 */

import type {
  EditContext,
  OverwriteMode,
  SegmentId,
  Vector3,
} from "../core/volume_annotation_types";
import type { MaskShape } from "../core/volume_edit_intents";
import { VolumeTransaction } from "../core/volume_transaction";
import { rasterize } from "../core/voxel_rasterizer";
import type { DriverOptions, DriverResult } from "./tool_driver_types";
import { magListForCube, WkDataCubeAdapter } from "./wk_data_cube_adapter";

export interface BrushDriverOptions extends DriverOptions {
  overwriteMode: OverwriteMode;
  /** See EditContext.overwritableValue. */
  overwritableValue: SegmentId;
  /**
   * Per-axis brush radius in source-mag voxels. Callers fold both the voxel
   * size and the mag into this, so the rasterizer needs neither.
   */
  radius: Vector3;
  /** Viewport normal: 0 = YZ, 1 = XZ, 2 = XY. */
  planeAxis: 0 | 1 | 2;
}

export class BrushDriver {
  private readonly adapter: WkDataCubeAdapter;
  private readonly transaction: VolumeTransaction;
  private readonly ctx: EditContext;
  private last: Vector3;

  readonly startedAt = performance.now();

  constructor(
    private readonly options: BrushDriverOptions,
    start: Vector3,
  ) {
    this.adapter = new WkDataCubeAdapter(options.cube, options.saveMode);
    this.ctx = {
      sourceMagIndex: options.magIndex,
      activeSegmentId: options.segmentId,
      overwriteMode: options.overwriteMode,
      overwritableValue: options.overwritableValue,
      editableBoundingBox: this.adapter.getEditableBoundingBox(options.magIndex),
      additionalCoordinates: options.additionalCoordinates,
    };
    this.transaction = new VolumeTransaction(
      `brush-${Date.now()}`,
      this.ctx,
      this.adapter,
      magListForCube(options.cube),
    );
    this.last = start;
    this.paint(start, start);
  }

  /** One pointer-move: rasterize only the incremental capsule. */
  extend(position: Vector3): void {
    this.paint(this.last, position);
    this.last = position;
  }

  private paint(from: Vector3, to: Vector3): void {
    rasterize(
      {
        kind: "brush",
        path: from === to ? [from] : [from, to],
        radius: this.options.radius,
        planeAxis: this.options.planeAxis,
      },
      this.ctx,
      this.transaction,
    );
    // Write through so the stroke is visible while the pointer is still down.
    this.transaction.flushToCube();
    this.adapter.flush();
  }

  /**
   * Add the auto-fill of a closed stroke to the stroke's transaction, so that
   * stroke and fill are propagated, diffed and undone as one. Call it before
   * `finish`, which writes the fill to the cube along with everything else.
   */
  fill(mask: MaskShape): void {
    rasterize(mask, this.ctx, this.transaction);
  }

  /**
   * Pointer-up: run mag propagation once over the coalesced write set, apply
   * it, and report what happened — including the bucket diffs, which the
   * caller hands to the save queue under the "partialUpdates" SaveMode.
   */
  finish(): DriverResult {
    const diff = this.transaction.commit(0, "brush");
    this.adapter.flush();

    let voxels = 0;
    for (const bucketDiff of diff.bucketDiffs) {
      for (const run of bucketDiff.runs) voxels += run.length;
    }
    return {
      voxels,
      buckets: diff.bucketDiffs.length,
      bucketDiffs: diff.bucketDiffs,
      mags: [...new Set(diff.bucketDiffs.map((d) => d.address[3]))].sort((a, b) => a - b),
      durationMs: performance.now() - this.startedAt,
    };
  }
}
