/**
 * Lets the core's rasterizer and mag propagation write into webKnossos' real
 * DataCube. Like the drivers next to it (brush_driver.ts,
 * flood_fill_driver.ts), this file bridges to `viewer/`; everything outside
 * `integration/` stays independent of it.
 *
 * Buckets are mutated in place, and no update actions are emitted here. How the
 * mutation is saved depends on the SaveMode: either the buckets are pushed to the
 * push queue and snapshotted for undo, as the old tools do, or they are not,
 * because the caller sends the transaction's bucket diffs as partial updates.
 *
 * One thing worth knowing about the boundary itself:
 *   - The core's BucketAddress (core/volume_annotation_types.ts) is structurally identical to
 *     the real one (xyz, magIndex, additionalCoordinates) on purpose, so
 *     addresses cross this boundary as-is — no conversion, no separate
 *     adapter-level additionalCoordinates override to keep in sync.
 */

import type { BucketDataArray } from "types/api_types";
import { createPartialChangeKey, type DataBucket } from "viewer/model/bucket_data_handling/bucket";
import type DataCube from "viewer/model/bucket_data_handling/data_cube";
import { applyBucketWriteToData, type BucketWrite } from "../core/bucket_write_map";
import {
  type BoundingBox,
  type BucketAddress,
  type Mag,
  type MagIndex,
  MagList,
  type SegmentBucketData,
  type SegmentId,
} from "../core/volume_annotation_types";
import type { LoadingVoxelCube, TransactionCube } from "../core/voxel_cube_interfaces";
import type { SaveMode } from "./tool_driver_types";

/**
 * A segmentation layer never stores float data, so its buckets are always a
 * member of SegmentBucketData — but `getData` and friends are typed for any
 * layer, which is why the narrowing happens here rather than at each call.
 */
function asSegmentData(data: BucketDataArray): SegmentBucketData {
  return data as SegmentBucketData;
}

export class WkDataCubeAdapter implements TransactionCube {
  // Buckets touched during the current stroke, so mutations can be flushed
  // ("fullBuckets" only).
  private readonly touchedFullBuckets = new Set<DataBucket>();
  // "partialUpdates" only: one key per bucket for its pending partial change (see
  // applyWrites).
  private readonly partialChangeKeyByBucket = new Map<DataBucket, number>();

  constructor(
    protected readonly cube: DataCube,
    private readonly saveMode: SaveMode,
  ) {}

  /**
   * A predicate answering "does this voxel currently hold overwritableValue?"
   * for one bucket, used by the rasterizer's overwrite-empty-only filter. Null
   * when the bucket has no data to test against, in which case the filter is
   * skipped.
   */
  getIsOverwritableFunction(
    address: BucketAddress,
    overwritableValue: SegmentId,
  ): ((index: number) => boolean) | null {
    const data = this.rawData(address);
    if (data == null) return null;
    if (data instanceof BigUint64Array || data instanceof BigInt64Array) {
      return (index) => data[index] === overwritableValue;
    }
    // Converted once here rather than per voxel: a non-64-bit bucket holds
    // numbers, and === never matches a number against a bigint.
    const numericValue = Number(overwritableValue);
    return (index) => data[index] === numericValue;
  }

  applyWrites(address: BucketAddress, write: BucketWrite): void {
    const bucket = this.cube.getOrCreateBucket(address);
    if (bucket.type === "null") return;

    // getOrCreateData rather than getData: a bucket that has not loaded yet
    // gets a zero-filled array plus temporal-bucket bookkeeping, which is how
    // the existing code paints over unloaded data too.
    const data = bucket.getOrCreateData();

    if (this.saveMode === "partialUpdates") {
      // A stroke's write grows with it and is applied again on every flush. With one
      // key per bucket and adapter (i.e., per edit), it replaces the bucket's pending
      // change from the previous flush instead of adding another one (see
      // DataBucket.applyPartialChange).
      let key = this.partialChangeKeyByBucket.get(bucket);
      if (key == null) {
        key = createPartialChangeKey();
        this.partialChangeKeyByBucket.set(bucket, key);
      }
      bucket.applyPartialChange(
        (bucketData) => applyBucketWriteToData(asSegmentData(bucketData), write),
        key,
      );
      return;
    }

    if (!this.touchedFullBuckets.has(bucket)) {
      bucket.startDataMutationForFullBucket();
      this.touchedFullBuckets.add(bucket);
    }

    applyBucketWriteToData(asSegmentData(data), write);

    // getOrCreateData's own docstring warns it is unsafe to mutate directly:
    // if the backend's data for this bucket has not arrived yet, that fetch
    // will later overwrite `data` wholesale (see bucket_snapshot.ts), silently
    // erasing the write above. So a pendingOperation additionally replays the
    // write once real data lands.
    if (bucket.needsBackendData()) {
      bucket.fullBucketSaveState.pendingOperations.push((laterData) =>
        applyBucketWriteToData(asSegmentData(laterData), write),
      );
    }
  }

  /**
   * With "fullBuckets", ends the mutation on every touched bucket, which pushes it
   * to the push queue and triggers a GPU refresh. With "partialUpdates", each write
   * already triggers the refresh.
   */
  flush(): void {
    for (const bucket of this.touchedFullBuckets) {
      bucket.endDataMutationForFullBucket();
    }
    this.touchedFullBuckets.clear();
  }

  /**
   * The DataCube's bounding box (e.g., the task bounding box) in the voxels of
   * the given mag. The DataCube drops writes to buckets outside of it, but not
   * to the outside part of a partially contained bucket. Clipping in the core
   * covers both, and keeps the diff free of discarded writes. Rounded like the
   * bucket containment in data_cube.ts.
   */
  getEditableBoundingBox(magIndex: MagIndex): BoundingBox {
    // Dense mags, since mag propagation also passes through mags that are
    // missing between two existing ones.
    const mag = this.cube.magInfo.getDenseMags()[magIndex];
    if (mag == null) throw new Error(`No mag at index ${magIndex}`);
    const { min, max } = this.cube.boundingBox.fromMag1ToMag(mag);
    return { min, max };
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

/**
 * Build the core's MagList from the cube's dense mags, propagating no finer than
 * the layer's finest mag.
 */
export function magListForCube(cube: DataCube): MagList {
  return new MagList(
    cube.magInfo.getDenseMags().map((mag) => [mag[0], mag[1], mag[2]] as Mag),
    cube.magInfo.getFinestMagIndex(),
  );
}
