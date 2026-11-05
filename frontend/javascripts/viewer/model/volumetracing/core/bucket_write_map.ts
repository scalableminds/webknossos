import { BucketVoxelMask } from "./bucket_voxel_mask";
import {
  type AdditionalCoordinate,
  type BoundingBox,
  BUCKET_WIDTH,
  type BucketAddress,
  type BucketKey,
  bucketAddressOfVoxel,
  bucketKey,
  type MagIndex,
  originVoxelOf,
  type SegmentBucketData,
  type SegmentId,
  type Vector3,
  voxelIndexOf,
  voxelOffsetInBucket,
  voxelOffsetOf,
} from "./volume_annotation_types";

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
 * Apply `write`'s runs onto a bucket array of any segmentation element class.
 * The branch is taken once per bucket, not once per run: `write.value` is a
 * SegmentId (always a bigint), so a non-64-bit array needs it converted, and
 * doing that inside the loop would repeat the same conversion per run.
 */
export function applyBucketWriteToData(data: SegmentBucketData, write: BucketWrite): void {
  if (data instanceof BigUint64Array || data instanceof BigInt64Array) {
    for (const { start, length } of write.mask.runs()) {
      data.fill(write.value, start, start + length);
    }
    return;
  }
  // Every non-64-bit member takes a number; TypeScript cannot narrow the
  // union's `fill` overloads, hence the single cast.
  const numeric = data as Uint32Array;
  const value = Number(write.value);
  for (const { start, length } of write.mask.runs()) {
    numeric.fill(value, start, start + length);
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
 * marks in the same bucket costs no lookup at all.
 *
 * The cache itself saves up to 60% of time in a single-bucket scenario (likely
 * during floodfills). The cache is keyed on the *address* (not on the stringified
 * BucketKey) to avoid building that string for each cache check. Cache usage in
 * `has` is most of that flood-fill win.
 */
export class BucketWriteMapBuilder {
  private readonly entries: BucketWriteMap = new Map();
  private cachedEntry: BucketWriteMapEntry | null = null;

  constructor(
    private readonly magIndex: MagIndex,
    private readonly value: SegmentId,
    private readonly additionalCoordinates: AdditionalCoordinate[] | null,
  ) {}

  /**
   * Given an `address`, returns the entry for it if it's cached (null
   * otherwise). additionalCoordinates is fixed for the builder's
   * lifetime, so it can be ignored here.
   */
  private cachedFor(address: BucketAddress): BucketWriteMapEntry | null {
    const cached = this.cachedEntry;
    if (
      cached != null &&
      cached.address[0] === address[0] &&
      cached.address[1] === address[1] &&
      cached.address[2] === address[2] &&
      cached.address[3] === address[3]
    ) {
      return cached;
    }
    return null;
  }

  /*
   * Returns the BucketWriteMapEntry for address. Reads/writes the cache.
   */
  private entryFor(address: BucketAddress): BucketWriteMapEntry {
    const cached = this.cachedFor(address);
    if (cached != null) return cached;

    const key = bucketKey(address);
    let entry = this.entries.get(key);
    if (entry == null) {
      entry = { address, write: { mask: new BucketVoxelMask(), value: this.value } };
      this.entries.set(key, entry);
    }
    this.cachedEntry = entry;
    return entry;
  }

  /*
   * Returns the BucketWriteMapEntry for address. Only reads the cache
   * (never updates it).
   */
  private peek(address: BucketAddress): BucketWriteMapEntry | undefined {
    const cached = this.cachedFor(address);
    if (cached != null) return cached;

    const entry = this.entries.get(bucketKey(address));
    if (entry != null) this.cachedEntry = entry;
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
    const entry = this.peek(bucketAddressOfVoxel(voxel, this.magIndex, this.additionalCoordinates));
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

/**
 * The writes of `bucketWriteMap` that lie within `box`, given in the voxels of
 * the write set's mag. Each bucket is either
 * - fully outside of the box: dropped,
 * - fully inside of it: passed on as it is, without copying its mask, or
 * - partially inside: its runs are cut to the box and copied into a new mask.
 */
export function clipBucketWriteMap(
  bucketWriteMap: BucketWriteMap,
  box: BoundingBox,
): BucketWriteMap {
  const clipped: BucketWriteMap = new Map();
  for (const [key, entry] of bucketWriteMap) {
    const origin = originVoxelOf(entry.address);
    // Min and max will contain the part of the box that overlaps the current bucket.
    // The values are voxel offsets within the bucket (0 to BUCKET_WIDTH).
    const min: Vector3 = [0, 0, 0];
    const max: Vector3 = [0, 0, 0];
    let isEmpty = false;
    let isFull = true;
    for (let axis = 0; axis < 3; axis++) {
      min[axis] = Math.max(box.min[axis] - origin[axis], 0);
      max[axis] = Math.min(box.max[axis] - origin[axis], BUCKET_WIDTH);
      if (min[axis] >= max[axis]) isEmpty = true;
      if (min[axis] > 0 || max[axis] < BUCKET_WIDTH) isFull = false;
    }
    if (isEmpty) continue;
    if (isFull) {
      clipped.set(key, entry);
      continue;
    }

    // Partially inside: keep a run only if its row lies within the box, and cut
    // it to the box along x. That suffices, since every run is an x-run within
    // one row (see BucketVoxelMask.runs).
    const mask = new BucketVoxelMask();
    for (const { start, length } of entry.write.mask.runs()) {
      const [x, y, z] = voxelOffsetOf(start);
      if (y < min[1] || y >= max[1] || z < min[2] || z >= max[2]) continue;
      const xStart = Math.max(x, min[0]);
      const xEnd = Math.min(x + length, max[0]);
      if (xStart < xEnd) mask.markRun(start + xStart - x, xEnd - xStart);
    }
    if (mask.count > 0) {
      clipped.set(key, { address: entry.address, write: { mask, value: entry.write.value } });
    }
  }
  return clipped;
}

/** Total number of marked voxels across a write set. Used by tests. */
export function countVoxels(bucketWriteMap: BucketWriteMap): number {
  let total = 0;
  for (const entry of bucketWriteMap.values()) total += entry.write.mask.count;
  return total;
}
