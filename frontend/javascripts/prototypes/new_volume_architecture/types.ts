/**
 * Core types for the volume-annotation architecture spike.
 *
 * This module is deliberately self-contained: nothing here is imported from the
 * production `viewer/` code, so the prototype cannot drift with it. A few small
 * things (Vector3, BUCKET_WIDTH) are therefore redeclared rather than shared.
 *
 * Simplifications versus the design doc:
 *   - No additional coordinates (4D/5D datasets). A BucketAddress is xyz + mag.
 *   - Layers are implicit; there is exactly one.
 */

export type Vector3 = [number, number, number];

/** Downsampling factor per axis relative to the finest mag, e.g. [2, 2, 1]. */
export type Mag = Vector3;

/** Index into the layer's ordered mag list. 0 === finest mag. */
export type MagIndex = number;

/** uint64 in the data format, therefore bigint here. 0n === background. */
export type SegmentId = bigint;

export const BUCKET_WIDTH = 32;
export const BUCKET_VOXEL_COUNT = BUCKET_WIDTH ** 3; // 32_768
export const FINEST_MAG_INDEX = 0;

/** [bucketX, bucketY, bucketZ, magIndex] */
export type BucketAddress = readonly [number, number, number, MagIndex];

/** Stable string form so a BucketAddress can be used as a Map key. */
export type BucketKey = string & { readonly __brand: "BucketKey" };

/**
 * Flat offset inside a bucket: `x + y * 32 + z * 1024` — x varies fastest.
 * Runs of consecutive indices are therefore runs along x.
 */
export type VoxelIndex = number;

export function bucketKey(address: BucketAddress): BucketKey {
  return `${address[0]},${address[1]},${address[2]},${address[3]}` as BucketKey;
}

/** Flat index from an offset *within* a bucket. All components must be 0..31. */
export function voxelIndexOf(x: number, y: number, z: number): VoxelIndex {
  return x + y * BUCKET_WIDTH + z * BUCKET_WIDTH * BUCKET_WIDTH;
}

/** Inverse of voxelIndexOf. */
export function voxelOffsetOf(index: VoxelIndex): Vector3 {
  return [
    index % BUCKET_WIDTH,
    Math.floor(index / BUCKET_WIDTH) % BUCKET_WIDTH,
    Math.floor(index / (BUCKET_WIDTH * BUCKET_WIDTH)),
  ];
}

/** Floor division that also behaves for negative coordinates. */
export function floorDiv(a: number, b: number): number {
  return Math.floor(a / b);
}

/** The bucket containing a voxel, where the voxel is in `magIndex`'s own grid. */
export function bucketAddressOfVoxel(voxel: Vector3, magIndex: MagIndex): BucketAddress {
  return [
    floorDiv(voxel[0], BUCKET_WIDTH),
    floorDiv(voxel[1], BUCKET_WIDTH),
    floorDiv(voxel[2], BUCKET_WIDTH),
    magIndex,
  ];
}

/** The voxel coordinate of a bucket's origin, in that mag's own grid. */
export function originVoxelOf(address: BucketAddress): Vector3 {
  return [address[0] * BUCKET_WIDTH, address[1] * BUCKET_WIDTH, address[2] * BUCKET_WIDTH];
}

/** Offset of a voxel within its bucket. */
export function voxelOffsetInBucket(voxel: Vector3): Vector3 {
  return [
    ((voxel[0] % BUCKET_WIDTH) + BUCKET_WIDTH) % BUCKET_WIDTH,
    ((voxel[1] % BUCKET_WIDTH) + BUCKET_WIDTH) % BUCKET_WIDTH,
    ((voxel[2] % BUCKET_WIDTH) + BUCKET_WIDTH) % BUCKET_WIDTH,
  ];
}

export type BoundingBox = { min: Vector3; max: Vector3 }; // max is exclusive

export function isInBoundingBox(voxel: Vector3, box: BoundingBox | null): boolean {
  if (box == null) return true;
  return (
    voxel[0] >= box.min[0] &&
    voxel[0] < box.max[0] &&
    voxel[1] >= box.min[1] &&
    voxel[1] < box.max[1] &&
    voxel[2] >= box.min[2] &&
    voxel[2] < box.max[2]
  );
}

/**
 * The layer's ordered list of mags, finest first. Every mag must be an integer
 * multiple of the next-finer one (§1.2: non-chain mag lists are unsupported),
 * which is what makes the propagation cascade in mag_propagation.ts possible.
 */
export class MagList {
  constructor(readonly mags: Mag[]) {
    if (mags.length === 0) throw new Error("MagList must not be empty");
    for (let i = 1; i < mags.length; i++) {
      // Throws if the list is not a chain.
      relativeFactorOrThrow(mags[i - 1], mags[i]);
    }
  }

  get length(): number {
    return this.mags.length;
  }

  get(index: MagIndex): Mag {
    const mag = this.mags[index];
    if (mag == null) throw new Error(`No mag at index ${index}`);
    return mag;
  }

  /** Per-axis ratio coarser/finer between two adjacent levels. */
  factorBetween(finerIndex: MagIndex, coarserIndex: MagIndex): Mag {
    return relativeFactorOrThrow(this.get(finerIndex), this.get(coarserIndex));
  }
}

function relativeFactorOrThrow(finer: Mag, coarser: Mag): Mag {
  const factor = [0, 0, 0] as Mag;
  for (let axis = 0; axis < 3; axis++) {
    const ratio = coarser[axis] / finer[axis];
    if (!Number.isInteger(ratio) || ratio < 1) {
      throw new Error(
        `Mag list is not a chain: ${coarser.join("-")} is not an integer multiple of ${finer.join("-")}`,
      );
    }
    factor[axis] = ratio;
  }
  return factor;
}

export type OverwriteMode = "overwrite-all" | "overwrite-empty-only";

/** Everything that is constant for the duration of one user interaction. */
export interface EditContext {
  /** The mag the user is looking at. The only mag the rasterizer runs at. */
  sourceMagIndex: MagIndex;
  activeSegmentId: SegmentId;
  overwriteMode: OverwriteMode;
  /** Annotation-level restriction; the rasterizer clips against it. */
  editableBoundingBox: BoundingBox | null;
}
