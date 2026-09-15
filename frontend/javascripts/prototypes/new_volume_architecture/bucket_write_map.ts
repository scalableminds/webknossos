import { BucketVoxelMask } from "./bucket_voxel_mask";
import {
  type AdditionalCoordinate,
  BUCKET_WIDTH,
  type BucketAddress,
  type BucketKey,
  bucketAddressOfVoxel,
  bucketKey,
  type MagIndex,
  type SegmentId,
  type Vector3,
  voxelIndexOf,
  voxelOffsetInBucket,
} from "./types";

/**
 * Writes for one bucket: which voxels were touched, and the single value being
 * written. A transaction is always single-valued — one brush stroke, one fill
 * each write one activeSegmentId, and mag propagation preserves values — so no
 * per-voxel value is ever stored.
 */
export interface BucketWrite {
  mask: BucketVoxelMask;
  value: SegmentId;
}

export interface BucketWriteMapEntry {
  address: BucketAddress;
  write: BucketWrite;
}

/**
 * Apply `write`'s runs onto a dense bigint bucket array. Real buckets may
 * additionally hold a non-64-bit element class, which is why `writeRuns`
 * still has a second branch of its own on top of this.
 */
export function applyBucketWriteToData(
  data: BigUint64Array | BigInt64Array,
  write: BucketWrite,
): void {
  for (const { start, length } of write.mask.runs()) {
    data.fill(write.value, start, start + length);
  }
}

/**
 * Voxel writes across buckets. This is the one currency exchanged between the
 * rasterizer, the resolver, mag propagation and the transaction.
 */
export type BucketWriteMap = Map<BucketKey, BucketWriteMapEntry>;

/**
 * Accumulates writes for one mag, addressing voxels in that mag's global grid
 * and splitting them into buckets. Caches the last bucket touched so a run of
 * marks in the same bucket costs one lookup.
 */
export class BucketWriteMapBuilder {
  private readonly entries: BucketWriteMap = new Map();
  private cachedKey: BucketKey | null = null;
  private cachedEntry: BucketWriteMapEntry | null = null;

  constructor(
    private readonly magIndex: MagIndex,
    private readonly value: SegmentId,
    private readonly additionalCoordinates: AdditionalCoordinate[] | null,
  ) {}

  private entryFor(address: BucketAddress): BucketWriteMapEntry {
    const key = bucketKey(address);
    if (key === this.cachedKey && this.cachedEntry != null) return this.cachedEntry;

    let entry = this.entries.get(key);
    if (entry == null) {
      entry = { address, write: { mask: new BucketVoxelMask(), value: this.value } };
      this.entries.set(key, entry);
    }
    this.cachedKey = key;
    this.cachedEntry = entry;
    return entry;
  }

  /** Mark one voxel, given in this builder's mag grid. */
  mark(voxel: Vector3): void {
    const entry = this.entryFor(
      bucketAddressOfVoxel(voxel, this.magIndex, this.additionalCoordinates),
    );
    const [x, y, z] = voxelOffsetInBucket(voxel);
    entry.write.mask.mark(voxelIndexOf(x, y, z));
  }

  /**
   * Mark `length` voxels along +x starting at `voxel`. Splits at bucket
   * boundaries, so callers may pass runs of any length.
   */
  markRun(voxel: Vector3, length: number): void {
    let remaining = length;
    let x = voxel[0];
    const [, y, z] = voxel;

    while (remaining > 0) {
      const address = bucketAddressOfVoxel([x, y, z], this.magIndex, this.additionalCoordinates);
      const offset = voxelOffsetInBucket([x, y, z]);
      const lengthInBucket = Math.min(remaining, BUCKET_WIDTH - offset[0]);
      const entry = this.entryFor(address);
      entry.write.mask.markRun(voxelIndexOf(offset[0], offset[1], offset[2]), lengthInBucket);
      x += lengthInBucket;
      remaining -= lengthInBucket;
    }
  }

  /** Whether a voxel has already been marked. Doubles as a "visited" test. */
  has(voxel: Vector3): boolean {
    const key = bucketKey(bucketAddressOfVoxel(voxel, this.magIndex, this.additionalCoordinates));
    const entry = this.entries.get(key);
    if (entry == null) return false;
    const [x, y, z] = voxelOffsetInBucket(voxel);
    return entry.write.mask.has(voxelIndexOf(x, y, z));
  }

  get markedVoxelCount(): number {
    let total = 0;
    for (const entry of this.entries.values()) total += entry.write.mask.count;
    return total;
  }

  build(): BucketWriteMap {
    return this.entries;
  }
}

/** Total number of marked voxels across a write set. Used by tests. */
export function countVoxels(bucketWriteMap: BucketWriteMap): number {
  let total = 0;
  for (const entry of bucketWriteMap.values()) total += entry.write.mask.count;
  return total;
}
