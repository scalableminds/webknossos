/**
 * SPIKE GLUE — the only file in this prototype that imports from `viewer/`.
 *
 * Lets the new rasterizer + mag propagation write into webKnossos' real
 * DataCube, so the brush can be tried in the browser. Deliberately dirty:
 *   - Buckets are mutated in place. Nothing is pushed to the save queue, no
 *     update actions are emitted, and undo is not wired up.
 *   - `additionalCoordinates` are threaded through but otherwise ignored.
 *   - The prototype's BucketAddress is xyz+mag; the real one carries a fifth
 *     element, so addresses are converted at this boundary.
 */

import type { BucketDataArray } from "types/api_types";
import type { AdditionalCoordinate, BucketAddress as WkBucketAddress } from "viewer/constants";
import type DataCube from "viewer/model/bucket_data_handling/data_cube";
import type { BucketWrite } from "../bucket_write_map";
import type { LoadingVoxelCube, TransactionCube } from "../cube";
import { BUCKET_VOXEL_COUNT, type BucketAddress, type Mag, MagList, type Vector3 } from "../types";

/** Fill the runs of `write` into `data`, whatever element class it is. */
function writeRuns(data: BucketDataArray, write: BucketWrite): void {
  // todop: similar to WkDataCubeAdapter.applyWrites ?
  if (data instanceof BigUint64Array || data instanceof BigInt64Array) {
    for (const { start, length } of write.mask.runs()) {
      data.fill(write.value, start, start + length);
    }
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
  /** Buckets touched during the current stroke, so mutations can be flushed. */
  private readonly touched = new Set<string>();

  constructor(
    protected readonly cube: DataCube,
    protected readonly additionalCoordinates: AdditionalCoordinate[] | null,
  ) {}

  protected toWkAddress(address: BucketAddress): WkBucketAddress {
    return [address[0], address[1], address[2], address[3], this.additionalCoordinates];
  }

  /**
   * Comparing against background does not require a common representation
   * across element classes, unlike a hypothetical "give me the dense resident
   * array" method would — which is exactly why `TransactionCube` has no such
   * method: nothing in this iteration needs one (see cube.ts).
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
    const bucket = this.cube.getOrCreateBucket(this.toWkAddress(address));
    if (bucket.type === "null") return;

    // getOrCreateData rather than getData: a bucket that has not loaded yet
    // gets a zero-filled array plus temporal-bucket bookkeeping, which is how
    // the existing code paints over unloaded data too.
    const data = bucket.getOrCreateData();
    const key = bucket.zoomedAddress.join(",");
    if (!this.touched.has(key)) {
      bucket.startDataMutation();
      // todop: maybe add the buckets directly (instead of the key) because we will later iterate over them anyway?
      this.touched.add(key);
    }

    writeRuns(data, write);

    // getOrCreateData's own docstring warns it is unsafe to mutate directly:
    // if the backend's data for this bucket has not arrived yet, that fetch
    // will later overwrite `data` wholesale (see bucket_snapshot.ts), silently
    // erasing the write above. bucket.needsBackendData() is the same check
    // Bucket.applyVoxelMap uses to decide whether to additionally register a
    // pendingOperation that replays the write once real data lands.
    if (bucket.needsBackendData()) {
      bucket.pendingOperations.push((laterData) => writeRuns(laterData, write));
    }
  }

  /** Ends the mutation on every touched bucket, triggering a GPU refresh. */
  flush(): void {
    for (const key of this.touched) {
      const parts = key.split(",").map(Number);
      const address: WkBucketAddress = [
        parts[0],
        parts[1],
        parts[2],
        parts[3],
        this.additionalCoordinates,
      ];
      const bucket = this.cube.getOrCreateBucket(address);
      if (bucket.type !== "null") bucket.endDataMutation();
    }
    this.touched.clear();
  }

  private rawData(address: BucketAddress): BucketDataArray | null {
    const bucket = this.cube.getBucket(this.toWkAddress(address));
    if (bucket.type === "null" || !bucket.hasData()) return null;
    return bucket.getData();
  }
}

/**
 * WkDataCubeAdapter plus the ability to await a bucket load, for the resolver
 * (§5.1: "the only component permitted to await a bucket load"). Kept separate
 * from WkDataCubeAdapter because the brush never needs to await anything —
 * §5.4 pointedly evaluates the overwrite predicate against whatever is
 * resident rather than fetching, so blocking reads would be a regression, not
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
    const bucket = this.cube.getOrCreateBucket(this.toWkAddress(address));
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

/** Build the prototype's MagList from a layer's MagInfo-derived dense mags. */
export function magListFromDenseMags(denseMags: Vector3[]): MagList {
  return new MagList(denseMags.map((mag) => [mag[0], mag[1], mag[2]] as Mag));
}
