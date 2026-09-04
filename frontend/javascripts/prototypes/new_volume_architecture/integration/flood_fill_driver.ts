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

import type { AdditionalCoordinate } from "viewer/constants";
import type DataCube from "viewer/model/bucket_data_handling/data_cube";
import { resolve } from "../resolver";
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
  signal?: AbortSignal;
}

export interface FloodFillResult {
  voxels: number;
  buckets: number;
  mags: number[];
  durationMs: number;
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

  const writeSet = await resolve(
    { kind: "floodFill", seed: options.seed, is3D: options.is3D, bounds: options.bounds },
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
  transaction.recordAll(writeSet);
  transaction.flushToCube();
  adapter.flush();

  const diff = transaction.commit(0, "floodFill");
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
