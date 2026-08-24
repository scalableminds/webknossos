import {
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
import { VoxelMask } from "./voxel_mask";

/**
 * Writes for one bucket: which voxels were touched, and the single value being
 * written. A transaction is always single-valued — one brush stroke, one fill
 * each write one activeSegmentId, and mag propagation preserves values — so no
 * per-voxel value is ever stored.
 */
export interface BucketWrites {
  mask: VoxelMask;
  value: SegmentId;
}

export interface WriteSetEntry {
  address: BucketAddress;
  writes: BucketWrites;
}

/**
 * Voxel writes across buckets. This is the one currency exchanged between the
 * rasterizer, the resolver, mag propagation and the transaction.
 */
export type VoxelWriteSet = Map<BucketKey, WriteSetEntry>;

/**
 * Accumulates writes for one mag, addressing voxels in that mag's global grid
 * and splitting them into buckets. Caches the last bucket touched so a run of
 * marks in the same bucket costs one lookup.
 */
export class WriteSetBuilder {
  private readonly entries: VoxelWriteSet = new Map();
  private cachedKey: BucketKey | null = null;
  private cachedEntry: WriteSetEntry | null = null;

  constructor(
    private readonly magIndex: MagIndex,
    private readonly value: SegmentId,
  ) {}

  private entryFor(address: BucketAddress): WriteSetEntry {
    const key = bucketKey(address);
    if (key === this.cachedKey && this.cachedEntry != null) return this.cachedEntry;

    let entry = this.entries.get(key);
    if (entry == null) {
      entry = { address, writes: { mask: new VoxelMask(), value: this.value } };
      this.entries.set(key, entry);
    }
    this.cachedKey = key;
    this.cachedEntry = entry;
    return entry;
  }

  /** Mark one voxel, given in this builder's mag grid. */
  mark(voxel: Vector3): void {
    const entry = this.entryFor(bucketAddressOfVoxel(voxel, this.magIndex));
    const [x, y, z] = voxelOffsetInBucket(voxel);
    entry.writes.mask.mark(voxelIndexOf(x, y, z));
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
      const address = bucketAddressOfVoxel([x, y, z], this.magIndex);
      const offset = voxelOffsetInBucket([x, y, z]);
      const lengthInBucket = Math.min(remaining, BUCKET_WIDTH - offset[0]);
      const entry = this.entryFor(address);
      entry.writes.mask.markRun(voxelIndexOf(offset[0], offset[1], offset[2]), lengthInBucket);
      x += lengthInBucket;
      remaining -= lengthInBucket;
    }
  }

  /** Whether a voxel has already been marked. Doubles as a "visited" test. */
  has(voxel: Vector3): boolean {
    const key = bucketKey(bucketAddressOfVoxel(voxel, this.magIndex));
    const entry = this.entries.get(key);
    if (entry == null) return false;
    const [x, y, z] = voxelOffsetInBucket(voxel);
    return entry.writes.mask.has(voxelIndexOf(x, y, z));
  }

  get markedVoxelCount(): number {
    let total = 0;
    for (const entry of this.entries.values()) total += entry.writes.mask.count;
    return total;
  }

  build(): VoxelWriteSet {
    return this.entries;
  }
}

/** Total number of marked voxels across a write set. Used by tests. */
export function countVoxels(writeSet: VoxelWriteSet): number {
  let total = 0;
  for (const entry of writeSet.values()) total += entry.writes.mask.count;
  return total;
}
