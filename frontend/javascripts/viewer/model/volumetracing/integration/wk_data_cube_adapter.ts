/**
 * Lets the core's rasterizer and mag propagation write into webKnossos' real
 * DataCube. Like the drivers next to it (brush_driver.ts,
 * flood_fill_driver.ts), this file bridges to `viewer/`; everything outside
 * `integration/` stays independent of it.
 *
 * Buckets are mutated in place: nothing is pushed to the save queue, no
 * update actions are emitted, and undo is not wired up. That is the state
 * design doc §12.2 records, not an oversight here.
 *
 * One thing worth knowing about the boundary itself:
 *   - The core's BucketAddress (core/volume_annotation_types.ts) is structurally identical to
 *     the real one (xyz, magIndex, additionalCoordinates) on purpose, so
 *     addresses cross this boundary as-is — no conversion, no separate
 *     adapter-level additionalCoordinates override to keep in sync.
 */

import type { BucketDataArray } from "types/api_types";
import type { DataBucket } from "viewer/model/bucket_data_handling/bucket";
import type DataCube from "viewer/model/bucket_data_handling/data_cube";
import { applyBucketWriteToData, type BucketWrite } from "../core/bucket_write_map";
import {
  type BucketAddress,
  type Mag,
  MagList,
  type SegmentBucketData,
  type Vector3,
} from "../core/volume_annotation_types";
import type { LoadingVoxelCube, TransactionCube } from "../core/voxel_cube_interfaces";

/**
 * A segmentation layer never stores float data, so its buckets are always a
 * member of SegmentBucketData — but `getData` and friends are typed for any
 * layer, which is why the narrowing happens here rather than at each call.
 */
function asSegmentData(data: BucketDataArray): SegmentBucketData {
  return data as SegmentBucketData;
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

    applyBucketWriteToData(asSegmentData(data), write);

    // getOrCreateData's own docstring warns it is unsafe to mutate directly:
    // if the backend's data for this bucket has not arrived yet, that fetch
    // will later overwrite `data` wholesale (see bucket_snapshot.ts), silently
    // erasing the write above. bucket.needsBackendData() is the same check
    // Bucket.applyVoxelMap uses to decide whether to additionally register a
    // pendingOperation that replays the write once real data lands.
    if (bucket.needsBackendData()) {
      bucket.pendingOperations.push((laterData) =>
        applyBucketWriteToData(asSegmentData(laterData), write),
      );
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
   * Load a bucket and hand over its data as it is stored.
   * Null when the address is outside the dataset.
   */
  async ensureLoaded(address: BucketAddress): Promise<SegmentBucketData | null> {
    const bucket = this.cube.getOrCreateBucket(address);
    if (bucket.type === "null") return null;
    return asSegmentData(await bucket.getDataForMutation());
  }
}

/** Build the core's MagList from a layer's MagInfo-derived dense mags. */
export function magListFromDenseMags(denseMags: Vector3[]): MagList {
  return new MagList(denseMags.map((mag) => [mag[0], mag[1], mag[2]] as Mag));
}
