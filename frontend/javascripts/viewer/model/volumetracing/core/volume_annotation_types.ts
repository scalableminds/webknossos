/**
 * Core types for the volume-annotation architecture.
 *
 * This module is deliberately self-contained: almost nothing here is imported from the
 * the rest of `viewer/`, so the core cannot drift with it. A few small
 * things (Vector3, BUCKET_WIDTH) are therefore redeclared rather than shared.
 * AdditionalCoordinate is the exception: it's reused as-is (see BucketAddress
 * below), rather than redeclared, since a structural mismatch there would
 * silently break the zero-conversion boundary crossing into the real
 * `viewer/` DataCube (see integration/wk_data_cube_adapter.ts).
 *
 * Simplifications versus the design doc:
 *   - Layers are implicit; there is exactly one.
 */

import type { BoundingBoxMinMaxType } from "types/bounding_box";
import type { AdditionalCoordinate, Vector3 } from "viewer/constants";

export type { AdditionalCoordinate, Vector3 };

/** Downsampling factor per axis relative to the finest mag, e.g. [2, 2, 1]. */
export type Mag = Vector3;

/** Index into the layer's ordered mag list. 0 === finest mag. */
export type MagIndex = number;

/**
 * The convention these three types encode: a *collection* of segment ids —
 * a bucket — is kept in the layer's own element class, while a single id
 * handed around on its own is always a bigint.
 */

/** uint64 in the data format, therefore bigint here. 0n === background. */
export type SegmentId = bigint;
/**
 * A voxel value as its bucket stores it: bigint for the 64-bit element
 * classes, number for the rest. Distinct from SegmentId, which is always a
 * bigint — this is what you get back from indexing a SegmentBucketData. Same
 * shape as `NumberLike` in viewer/store.ts, redeclared to keep the core free
 * of that import.
 */
export type StoredSegmentId = number | bigint;
/**
 * A dense 32³ bucket of segment ids, in whatever element class the layer
 * stores. Every element class a segmentation layer can have, which is
 * `BucketDataArray` (types/api_types) minus Float32Array — spelling out the
 * ArrayBuffer type parameter so the two stay assignable at the boundary.
 */
export type SegmentBucketData =
  | Uint8Array<ArrayBuffer>
  | Int8Array<ArrayBuffer>
  | Uint16Array<ArrayBuffer>
  | Int16Array<ArrayBuffer>
  | Uint32Array<ArrayBuffer>
  | Int32Array<ArrayBuffer>
  | BigUint64Array<ArrayBuffer>
  | BigInt64Array<ArrayBuffer>;

export const BUCKET_WIDTH = 32;
/** log2(BUCKET_WIDTH) and BUCKET_WIDTH - 1, so the per-voxel address
 * arithmetic below can shift and mask instead of dividing. */
export const BUCKET_WIDTH_LOG2 = 5;
export const BUCKET_WIDTH_MASK = BUCKET_WIDTH - 1;
export const BUCKET_VOXEL_COUNT = BUCKET_WIDTH ** 3; // 32_768
export const FINEST_MAG_INDEX = 0;

/**
 * [bucketX, bucketY, bucketZ, magIndex, additionalCoordinates]. The 5th slot
 * is always present (rather than the optional 5th element the real
 * `viewer/constants` BucketAddress allows) so every construction site has to
 * decide what it is, instead of quietly defaulting to "none" by omission.
 */
export type BucketAddress = readonly [
  number,
  number,
  number,
  MagIndex,
  AdditionalCoordinate[] | null,
];

/** Stable string form so a BucketAddress can be used as a Map key. */
export type BucketKey = string & { readonly __brand: "BucketKey" };

/**
 * Flat offset inside a bucket: `x + y * 32 + z * 1024` — x varies fastest.
 * Runs of consecutive indices are therefore runs along x.
 */
export type VoxelIndex = number;

export function bucketKey(address: BucketAddress): BucketKey {
  const additionalCoordinates = address[4];
  // Empty and null both mean "no additional axes"; treated identically so
  // the two never accidentally address different buckets.
  const coordinateSuffix =
    additionalCoordinates == null || additionalCoordinates.length === 0
      ? ""
      : `;${additionalCoordinates.map((coord) => `${coord.name}=${coord.value}`).join(",")}`;
  return `${address[0]},${address[1]},${address[2]},${address[3]}${coordinateSuffix}` as BucketKey;
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

/**
 * `floorDiv(coordinate, BUCKET_WIDTH)` without the division. An arithmetic
 * right shift rounds towards negative infinity, which is exactly what
 * `Math.floor` does here, and it agrees for negative coordinates too
 * (`-33 >> 5 === -2 === Math.floor(-33 / 32)`). Worth the specialisation
 * because the flood-fill traversal calls it per visited voxel.
 */
export function bucketIndexOfCoordinate(coordinate: number): number {
  return coordinate >> BUCKET_WIDTH_LOG2;
}

/** The bucket containing a voxel, where the voxel is in `magIndex`'s own grid. */
export function bucketAddressOfVoxel(
  voxel: Vector3,
  magIndex: MagIndex,
  additionalCoordinates: AdditionalCoordinate[] | null,
): BucketAddress {
  return [
    bucketIndexOfCoordinate(voxel[0]),
    bucketIndexOfCoordinate(voxel[1]),
    bucketIndexOfCoordinate(voxel[2]),
    magIndex,
    additionalCoordinates,
  ];
}

/** The voxel coordinate of a bucket's origin, in that mag's own grid. */
export function originVoxelOf(address: BucketAddress): Vector3 {
  return [address[0] * BUCKET_WIDTH, address[1] * BUCKET_WIDTH, address[2] * BUCKET_WIDTH];
}

/** Offset of a voxel within its bucket. */
export function voxelOffsetInBucket(voxel: Vector3): Vector3 {
  // `v & BUCKET_WIDTH_MASK` is equivalent to `v % BUCKET_WIDTH` (or to be precise:
  // `((v % BUCKET_WIDTH) + BUCKET_WIDTH) % BUCKET_WIDTH` which makes it compatible with
  // negative values).
  return [voxel[0] & BUCKET_WIDTH_MASK, voxel[1] & BUCKET_WIDTH_MASK, voxel[2] & BUCKET_WIDTH_MASK];
}

export type BoundingBox = BoundingBoxMinMaxType;

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
  /**
   * Which point in the dataset's extra axes (time, channel, ...) this
   * interaction edits. Constant for the whole transaction — a single stroke
   * or fill never spans more than one point in additional-coordinate space —
   * so every BucketAddress this interaction produces carries this same value
   * in its own 5th slot; this field is the one place that value comes from.
   */
  additionalCoordinates: AdditionalCoordinate[] | null;
}
