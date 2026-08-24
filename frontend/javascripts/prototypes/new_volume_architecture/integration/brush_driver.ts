/**
 * SPIKE GLUE — drives a brush stroke through the new architecture against
 * webKnossos' real DataCube.
 *
 * The saga owns the event loop (START_EDITING / ADD_TO_CONTOUR_LIST /
 * FINISH_EDITING); this owns everything between. Nothing here touches the save
 * queue, update actions, or undo — buckets are mutated in place only.
 */

import type { AdditionalCoordinate } from "viewer/constants";
import type DataCube from "viewer/model/bucket_data_handling/data_cube";
import { rasterize } from "../rasterizer";
import { VolumeTransaction } from "../transaction";
import type { EditContext, MagIndex, OverwriteMode, SegmentId, Vector3 } from "../types";
import { magListFromDenseMags, WkDataCubeAdapter } from "./wk_cube_adapter";

export interface BrushDriverOptions {
  cube: DataCube;
  denseMags: Vector3[];
  magIndex: MagIndex;
  segmentId: SegmentId;
  overwriteMode: OverwriteMode;
  additionalCoordinates: AdditionalCoordinate[] | null;
  /** Brush radius, already expressed in source-mag voxels. */
  radius: number;
  /** Viewport normal: 0 = YZ, 1 = XZ, 2 = XY. */
  planeAxis: 0 | 1 | 2;
}

export class BrushDriver {
  private readonly adapter: WkDataCubeAdapter;
  private readonly transaction: VolumeTransaction;
  private readonly ctx: EditContext;
  private last: Vector3;
  private segmentCount = 0;

  readonly startedAt = performance.now();

  constructor(
    private readonly options: BrushDriverOptions,
    start: Vector3,
  ) {
    this.adapter = new WkDataCubeAdapter(options.cube, options.additionalCoordinates);
    this.ctx = {
      sourceMagIndex: options.magIndex,
      activeSegmentId: options.segmentId,
      overwriteMode: options.overwriteMode,
      editableBoundingBox: null,
    };
    this.transaction = new VolumeTransaction(
      `spike-${Date.now()}`,
      this.ctx,
      this.adapter,
      magListFromDenseMags(options.denseMags),
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
    this.segmentCount++;
    // Write through so the stroke is visible while the pointer is still down.
    this.transaction.flushToCube();
    this.adapter.flush();
  }

  /**
   * Pointer-up: run mag propagation once over the coalesced write set, apply
   * it, and report what happened. The returned diff is *not* saved.
   */
  finish(): { voxels: number; buckets: number; mags: number[]; durationMs: number } {
    const diff = this.transaction.commit(0, "brush");
    this.adapter.flush();

    let voxels = 0;
    for (const bucketDiff of diff.bucketDiffs) {
      for (const run of bucketDiff.runs) voxels += run.length;
    }
    return {
      voxels,
      buckets: diff.bucketDiffs.length,
      mags: [...new Set(diff.bucketDiffs.map((d) => d.address[3]))].sort((a, b) => a - b),
      durationMs: performance.now() - this.startedAt,
    };
  }
}
