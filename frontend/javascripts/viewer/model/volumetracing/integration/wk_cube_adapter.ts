/**
 * SPIKE GLUE — like the drivers next to it (brush_driver.ts,
 * flood_fill_driver.ts), this file bridges to `viewer/`; everything outside
 * `integration/` stays independent of it.
 *
 * Lets the new rasterizer + mag propagation write into webKnossos' real
 * DataCube, so the new implementation can be tried in the browser.
 * Deliberately dirty:
 *   - Buckets are mutated in place. Nothing is pushed to the save queue, no
 *     update actions are emitted, and undo is not wired up.
 *   - The core's BucketAddress (core/types.ts) is structurally identical to
 *     the real one (xyz, magIndex, additionalCoordinates) on purpose, so
 *     addresses cross this boundary as-is — no conversion, no separate
 *     adapter-level additionalCoordinates override to keep in sync.
 */

import type { BucketDataArray } from "types/api_types";
import type { DataBucket } from "viewer/model/bucket_data_handling/bucket";
import type DataCube from "viewer/model/bucket_data_handling/data_cube";
import { applyBucketWriteToData, type BucketWrite } from "../core/bucket_write_map";
import type { LoadingVoxelCube, TransactionCube } from "../core/cube";
import {
  BUCKET_VOXEL_COUNT,
  type BucketAddress,
  type Mag,
  MagList,
  type Vector3,
} from "../core/types";

/**
 * Apply `write` to a real bucket's data array, whatever element class it
 * holds. The 64-bit case is the shared `applyBucketWriteToData`; the rest is
 * the numeric conversion only real buckets need.
 */
function applyWriteToAnyElementClass(data: BucketDataArray, write: BucketWrite): void {
  if (data instanceof BigUint64Array || data instanceof BigInt64Array) {
    applyBucketWriteToData(data, write);
  } else {
    // Every non-64-bit variant of BucketDataArray takes a number; TypeScript
    // cannot narrow the union's `fill` overloads, hence the single cast.
    const numeric = data as Uint32Array;
    const value = Number(write.value);
    for (const { start, length } of write.mask.runs()) {
      numeric.fill(value, start, start + length);
    }
  }
}

export class WkDataCubeAdapter implements TransactionCube {
  // Buckets touched during the current stroke, so mutations can be flushed.
  private readonly touched = new Set<DataBucket>();

  constructor(protected readonly cube: DataCube) {}

  /**
   * A predicate answering "is this voxel currently background?" for one
   * bucket, used by the rasterizer's overwrite-empty-only filter. Null when
   * the bucket has no data to test against, in which case the filter is
   * skipped.
   */
  backgroundProbe(address: BucketAddress): ((index: number) => boolean) | null {
    const data = this.rawData(address);
    if (data == null) return null;
    if (data instanceof BigUint64Array || data instanceof BigInt64Array) {
      return (index) => data[index] === 0n;
    }
    return (index) => data[index] === 0;
  }

  applyWrites(address: BucketAddress, write: BucketWrite): void {
    const bucket = this.cube.getOrCreateBucket(address);
    if (bucket.type === "null") return;

    // getOrCreateData rather than getData: a bucket that has not loaded yet
    // gets a zero-filled array plus temporal-bucket bookkeeping, which is how
    // the existing code paints over unloaded data too.
    const data = bucket.getOrCreateData();
    if (!this.touched.has(bucket)) {
      bucket.startDataMutation();
      this.touched.add(bucket);
    }

    applyWriteToAnyElementClass(data, write);

    // getOrCreateData's own docstring warns it is unsafe to mutate directly:
    // if the backend's data for this bucket has not arrived yet, that fetch
    // will later overwrite `data` wholesale (see bucket_snapshot.ts), silently
    // erasing the write above. bucket.needsBackendData() is the same check
    // Bucket.applyVoxelMap uses to decide whether to additionally register a
    // pendingOperation that replays the write once real data lands.
    if (bucket.needsBackendData()) {
      bucket.pendingOperations.push((laterData) => applyWriteToAnyElementClass(laterData, write));
    }
  }

  /** Ends the mutation on every touched bucket, triggering a GPU refresh. */
  flush(): void {
    for (const bucket of this.touched) {
      bucket.endDataMutation();
    }
    this.touched.clear();
  }

  private rawData(address: BucketAddress): BucketDataArray | null {
    const bucket = this.cube.getBucket(address);
    if (bucket.type === "null" || !bucket.hasData()) return null;
    return bucket.getData();
  }
}

/**
 * WkDataCubeAdapter plus the ability to await a bucket load, for the resolver
 * (§5.1: "the only component permitted to await a bucket load"). Kept separate
 * from WkDataCubeAdapter because the brush never needs to await anything —
 * §5.4 pointedly evaluates the overwrite predicate against whatever is
 * loaded rather than fetching, so blocking reads would be a regression, not
 * a feature, on that path.
 */
export class WkLoadingCubeAdapter extends WkDataCubeAdapter implements LoadingVoxelCube {
  /**
   * Load a bucket and return its dense content, converted to segment ids. Real
   * buckets may hold any element class, but the resolver only ever compares
   * values for equality (it never writes through this array), so a lossless
   * per-voxel bigint cast is enough.
   */
  async ensureLoaded(address: BucketAddress): Promise<BigUint64Array> {
    const bucket = this.cube.getOrCreateBucket(address);
    if (bucket.type === "null") {
      // Out of the dataset's bounds. `ctx.editableBoundingBox` / `shape.bounds`
      // (§5.1) should already keep the traversal from reaching here in the
      // normal case; treat it as an all-background bucket rather than
      // throwing, so a fill that grazes the edge doesn't abort outright.
      return new BigUint64Array(BUCKET_VOXEL_COUNT);
    }

    const data = await bucket.getDataForMutation();
    if (data instanceof BigUint64Array) return data;
    if (data instanceof BigInt64Array) {
      return new BigUint64Array(data.buffer, data.byteOffset, data.length);
    }

    const converted = new BigUint64Array(BUCKET_VOXEL_COUNT);
    for (let i = 0; i < data.length; i++) converted[i] = BigInt(data[i]);
    return converted;
  }
}

/** Build the core's MagList from a layer's MagInfo-derived dense mags. */
export function magListFromDenseMags(denseMags: Vector3[]): MagList {
  return new MagList(denseMags.map((mag) => [mag[0], mag[1], mag[2]] as Mag));
}
