/**
 * The cube contract: what the transaction, the resolver and the rasterizer
 * are allowed to assume about whatever holds bucket data. The production
 * implementation is `integration/wk_cube_adapter.ts`, over the real DataCube;
 * `not_yet_integrated/working_data_cube.ts` is the in-memory stand-in used by tests.
 */

import type { BucketWrite } from "./bucket_write_map";
import type { BucketAddress } from "./types";

/**
 * What can be done with a bucket right now. Two of the three states have no
 * counterpart in `BucketStateEnum` (bucket.ts), which tracks how far along the
 * *fetch* is rather than what the array is good for:
 *   - `absent`  — nothing allocated, and writes against the address are still
 *     fine (they live in the write set / journal). The real DataCube cannot do
 *     this: `applyVoxelMap` calls `getOrCreateData()` first thing, so writing
 *     always materializes.
 *   - `pending` — an array exists but does not hold backend content yet. Covers
 *     `REQUESTED`, and `UNREQUESTED` after a failed request (which leaves
 *     pendingOperations queued).
 *   - `loaded`  — exactly `BucketStateEnum.LOADED`: the array holds the
 *     backend's content with all known local diffs folded in. Orthogonal to
 *     dirty, in both models.
 */
export type BucketState = "absent" | "pending" | "loaded";

/**
 * The narrow surface a VolumeTransaction needs. Kept separate from
 * WorkingDataCube so a real backing store can be substituted — see
 * `integration/wk_cube_adapter.ts`.
 */
export interface TransactionCube {
  /** Apply a bucket's writes at once, walking the mask's runs. */
  applyWrites(address: BucketAddress, write: BucketWrite): void;
  /**
   * A predicate telling the overwrite filter whether a voxel is background, or
   * null when the bucket has no authoritative content to test against.
   *
   * This is a probe rather than a raw array because real buckets may hold any
   * element class, and only the owner of the data knows how to compare against
   * background without materializing a converted copy.
   */
  backgroundProbe(address: BucketAddress): ((index: number) => boolean) | null;
}

/**
 * The narrow surface the resolver needs to load data during a traversal (e.g.
 * flood fill, §5.1: "the only component permitted to await a bucket load").
 * Kept separate from WorkingDataCube for the same reason as TransactionCube —
 * see `integration/wk_cube_adapter.ts`.
 */
export interface LoadingVoxelCube extends TransactionCube {
  /** Load a bucket and return its dense content. The resolver's only await. */
  ensureLoaded(address: BucketAddress): Promise<BigUint64Array>;
}

/** What the cube fetches from. Tests supply an in-memory implementation. */
export interface BackendLike {
  fetchBucket(address: BucketAddress): Promise<{ data: BigUint64Array; version: number }>;
}
