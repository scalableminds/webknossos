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

import type { Transform } from "viewer/model/helpers/transformation_helpers";
import type {
  EditContext,
  OverwriteMode,
  SegmentId,
  Vector3,
} from "../core/volume_annotation_types";
import type { AffineMap, MaskShape } from "../core/volume_edit_intents";
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
  /**
   * Set when the layer is rendered with a transform. Then, positions, radius and
   * planeAxis are given in the rendered space instead (see voxelToRenderedSpaceMap).
   */
  voxelToShapeSpace?: AffineMap;
}

// Matrix entries closer than this to an integer are rounded to it. Chained
// transforms (e.g., a rotation around a center) leave rounding errors such as
// cos(90°) = 6e-17 that would otherwise make voxels that touch the plane flicker
// in and out of the painted slice.
const MATRIX_ROUNDING_TOLERANCE = 1e-9;

export function roundIfAlmostInteger(value: number): number {
  const rounded = Math.round(value);
  return Math.abs(value - rounded) < MATRIX_ROUNDING_TOLERANCE ? rounded : value;
}

/**
 * Maps voxels of `mag` of a layer to mag-1 voxels of the rendered space, for a
 * layer that is rendered with the given affine transform.
 */
export function voxelToRenderedSpaceMap(transform: Transform, mag: Vector3): AffineMap {
  if (transform.type !== "affine") {
    throw new Error("The brush only supports affine transforms.");
  }
  // The matrix is row-major and maps mag-1 voxels of the layer to the rendered space.
  const matrix = transform.affineMatrix;
  const linear = [0, 1, 2].flatMap((row) =>
    [0, 1, 2].map((column) => roundIfAlmostInteger(matrix[row * 4 + column] * mag[column])),
  ) as unknown as AffineMap["linear"];
  const offset = [0, 1, 2].map((row) => roundIfAlmostInteger(matrix[row * 4 + 3])) as Vector3;
  return { linear, offset };
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
        voxelToShapeSpace: this.options.voxelToShapeSpace,
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
