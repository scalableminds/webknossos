/**
 * SPIKE GLUE — drives a flood fill through the new architecture against
 * webKnossos' real DataCube.
 *
 * Unlike the brush there is no pointer-driven interaction to drive: resolving
 * a data-dependent shape *is* rasterizing it (§5.1 of the design doc — "there
 * is no intermediate shape: resolution is rasterization for these tools"), so
 * this is one async call rather than a begin/extend/finish state machine.
 *
 * Nothing here touches the save queue, update actions, or undo — buckets are
 * mutated in place only, exactly like brush_driver.ts.
 */

import { V3 } from "libs/mjs";
import type { Mesh } from "three";
import type { AdditionalCoordinate } from "viewer/constants";
import type DataCube from "viewer/model/bucket_data_handling/data_cube";
import { checkLineIntersection } from "viewer/model/bucket_data_handling/data_cube";
import { resolveFloodFill } from "../resolver";
import { VolumeTransaction } from "../transaction";
import type { BoundingBox, EditContext, MagIndex, SegmentId, Vector3 } from "../types";
import { magListFromDenseMags, WkLoadingCubeAdapter } from "./wk_cube_adapter";

export interface FloodFillDriverOptions {
  cube: DataCube;
  denseMags: Vector3[];
  magIndex: MagIndex;
  segmentId: SegmentId;
  additionalCoordinates: AdditionalCoordinate[] | null;
  seed: Vector3;
  is3D: boolean;
  /**
   * Restricts the traversal to a region (the same bounding box the old
   * `cube.floodFill` computes via `getBoundingBoxForFloodFill`), which is also
   * what keeps an unbounded fill from running away.
   */
  bounds: BoundingBox | null;
  /**
   * "Split Segments" toolkit boundary: the fill will not cross it. Mirrors
   * `splitBoundaryMesh` in the old `DataCube.floodFill` (data_cube.ts).
   */
  splitBoundaryMesh: Mesh | null;
  signal?: AbortSignal;
}

export interface FloodFillResult {
  voxels: number;
  buckets: number;
  mags: number[];
  durationMs: number;
  /**
   * True iff `bounds` cut the fill off before it ran out of matching,
   * connected voxels on its own — i.e. the true region may extend beyond
   * `coveredBoundingBox`. Mirrors `wasBoundingBoxExceeded` from the old
   * `DataCube.floodFill` (data_cube.ts), which the caller used to decide
   * whether to warn the user and mark the covered region with a bounding box.
   */
  wasBoundingBoxExceeded: boolean;
  /**
   * Tight bounding box around every written voxel, in mag-1 (global) space —
   * the same space `addUserBoundingBoxAction` expects. Null if nothing was
   * written (including the seed-already-matches no-op).
   */
  coveredBoundingBox: BoundingBox | null;
}

/**
 * Resolves the fill — the only step that awaits — then commits it as a single
 * transaction, synchronously. That ordering is what keeps "a transaction never
 * spans an await" true for this tool too (§5.1).
 */
export async function runFloodFill(options: FloodFillDriverOptions): Promise<FloodFillResult> {
  const startedAt = performance.now();
  const adapter = new WkLoadingCubeAdapter(options.cube, options.additionalCoordinates);
  const ctx: EditContext = {
    sourceMagIndex: options.magIndex,
    activeSegmentId: options.segmentId,
    // Flood fill has no user-facing overwrite toggle: it always replaces
    // exactly the voxels connected to the seed's original id, which is the
    // "overwrite-all" semantics as far as the rasterizing write set goes.
    overwriteMode: "overwrite-all",
    editableBoundingBox: null,
  };

  // checkLineIntersection expects mag1 voxel coordinates; a source-mag voxel
  // q sits at mag1 position q*mag (the same conversion coveredBoundingBoxMag1
  // uses below, just for a point rather than a box corner).
  const mag = options.denseMags[options.magIndex];
  const splitBoundaryMesh = options.splitBoundaryMesh;
  const isBlocked = splitBoundaryMesh
    ? (from: Vector3, to: Vector3): boolean =>
        checkLineIntersection(splitBoundaryMesh, V3.scale3(from, mag), V3.scale3(to, mag))
    : undefined;

  const { bucketWrites, wasBoundingBoxExceeded, coveredBoundingBox } = await resolveFloodFill(
    {
      kind: "floodFill",
      seed: options.seed,
      is3D: options.is3D,
      bounds: options.bounds,
      isBlocked,
    },
    ctx,
    adapter,
    options.signal,
  );

  const transaction = new VolumeTransaction(
    `spike-floodfill-${Date.now()}`,
    ctx,
    adapter,
    magListFromDenseMags(options.denseMags),
  );
  transaction.recordAll(bucketWrites);
  transaction.flushToCube();
  adapter.flush();

  const diff = transaction.commit(0, "floodFill");
  adapter.flush();

  let voxels = 0;
  for (const bucketDiff of diff.bucketDiffs) {
    for (const run of bucketDiff.runs) voxels += run.length;
  }

  // coveredBoundingBox is in source-mag voxels, max exclusive; a source voxel
  // q covers the mag1 block [q*mag, (q+1)*mag), so both bounds convert by the
  // same per-axis multiply — including the exclusive max, since (q+1)*mag is
  // exactly the mag1-space exclusive upper bound of the block at index q.
  const coveredBoundingBoxMag1: BoundingBox | null =
    coveredBoundingBox == null
      ? null
      : {
          min: [
            coveredBoundingBox.min[0] * mag[0],
            coveredBoundingBox.min[1] * mag[1],
            coveredBoundingBox.min[2] * mag[2],
          ],
          max: [
            coveredBoundingBox.max[0] * mag[0],
            coveredBoundingBox.max[1] * mag[1],
            coveredBoundingBox.max[2] * mag[2],
          ],
        };

  return {
    voxels,
    buckets: diff.bucketDiffs.length,
    mags: [...new Set(diff.bucketDiffs.map((d) => d.address[3]))].sort((a, b) => a - b),
    durationMs: performance.now() - startedAt,
    wasBoundingBoxExceeded,
    coveredBoundingBox: coveredBoundingBoxMag1,
  };
}
