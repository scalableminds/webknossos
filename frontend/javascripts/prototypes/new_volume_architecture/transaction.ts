import { BucketVoxelMask } from "./bucket_voxel_mask";
import type { BucketWriteMap, BucketWriteMapEntry } from "./bucket_write_map";
import type { TransactionCube } from "./cube";
import { type BeforeRun, bucketDiffsOf, type TransactionDiff, type TransactionId } from "./diff";
import { propagate } from "./mag_propagation";
import {
  type BucketAddress,
  type BucketKey,
  bucketKey,
  type EditContext,
  type MagIndex,
  type MagList,
  type SegmentId,
  type VoxelIndex,
} from "./types";

/**
 * Bucket-scoped write cursor. Obtained once per bucket, then written to in a
 * tight loop — nothing in here computes a bucket address or a BucketKey.
 */
export interface BucketWriter {
  mark(index: VoxelIndex): void;
  markRun(start: VoxelIndex, length: number): void;
  /**
   * Whether a voxel currently holds background, resolved once per bucket. Null
   * when the bucket has no authoritative content to test against — absent and
   * pending buckets alike — in which case the overwrite filter is skipped.
   */
  readonly isBackground: ((index: VoxelIndex) => boolean) | null;
}

/**
 * One transaction per user interaction. A write recorder, not a snapshot
 * differ: it accumulates a per-bucket mask plus the single value being written,
 * which coalesces repeated writes for free and works for buckets that are not
 * in memory.
 *
 * A transaction never spans an `await`. Data-dependent tools resolve first and
 * hand the finished write set to `recordAll`.
 */
export class VolumeTransaction {
  private readonly bucketWrites: BucketWriteMap = new Map();
  /** Pre-transaction values, first touch only, resident buckets only. */
  // todop: how about Map<BucketKey, Map<SegmentId, VoxelIndex[]>>
  // todop: what about buckets that arent downloaded yet?
  private readonly beforeAccumulating = new Map<BucketKey, Map<VoxelIndex, SegmentId>>();
  private committed = false;

  constructor(
    readonly id: TransactionId,
    readonly ctx: EditContext,
    private readonly cube: TransactionCube,
    private readonly mags: MagList,
  ) {}

  private entryFor(address: BucketAddress, value: SegmentId): BucketWriteMapEntry {
    const key = bucketKey(address);
    let entry = this.bucketWrites.get(key);
    if (entry == null) {
      entry = { address, write: { mask: new BucketVoxelMask(), value } };
      this.bucketWrites.set(key, entry);
    }
    return entry;
  }

  /**
   * Open a write cursor for one bucket. Does not require the bucket to be
   * resident. Materialized buckets are written through to immediately so the
   * GPU picks the change up on the next texture update.
   */
  writerFor(address: BucketAddress, value: SegmentId): BucketWriter {
    const entry = this.entryFor(address, value);
    const key = bucketKey(address);
    const current = this.cube.getResident(address);
    const isBackground = this.cube.backgroundProbe(address);

    let before = this.beforeAccumulating.get(key);
    if (before == null && current != null) {
      before = new Map();
      this.beforeAccumulating.set(key, before);
    }

    const captureBefore = (index: VoxelIndex) => {
      if (before == null || current == null) return;
      if (!before.has(index)) before.set(index, current[index]);
    };

    return {
      isBackground,
      mark(index: VoxelIndex) {
        captureBefore(index);
        entry.write.mask.mark(index);
      },
      markRun(start: VoxelIndex, length: number) {
        // todop: can we make this more efficient?
        for (let i = start; i < start + length; i++) captureBefore(i);
        entry.write.mask.markRun(start, length);
      },
    };
  }

  /** Merge a whole write set (from the resolver, or a remote peer). */
  // todop: could this be cheaper in case the current transaction is empty?
  recordAll(bucketWriteMap: BucketWriteMap): void {
    for (const incoming of bucketWriteMap.values()) {
      const writer = this.writerFor(incoming.address, incoming.write.value);
      for (const { start, length } of incoming.write.mask.runs()) {
        writer.markRun(start, length);
      }
    }
  }

  /** Push accumulated source-mag writes into the cube for live feedback. */
  flushToCube(): void {
    for (const entry of this.bucketWrites.values()) {
      this.cube.applyWrites(entry.address, entry.write);
    }
  }

  get sourceWrites(): BucketWriteMap {
    return this.bucketWrites;
  }

  /**
   * Pre-transaction values for every bucket in `bucketWrites` that has a
   * `beforeAccumulating` entry (i.e. was resident when first touched) — never
   * for buckets mag propagation touches, since `beforeAccumulating` is only
   * ever populated at the source mag (writerFor is only called from the
   * rasterizer and recordAll, both source-mag-only).
   *
   * Reuses the exact same runs `toRuns` walks off the mask, rather than
   * recomputing run boundaries independently: old values have no structure of
   * their own worth preserving (§5.6 — they're arbitrary per voxel), so there
   * is nothing to gain from splitting them differently than the new write is
   * split, and reusing the boundaries keeps the two arrays trivially zippable.
   */
  private buildBeforeCommitted(): Map<BucketKey, BeforeRun[]> {
    const result = new Map<BucketKey, BeforeRun[]>();
    for (const entry of this.bucketWrites.values()) {
      const key = bucketKey(entry.address);
      const before = this.beforeAccumulating.get(key);
      if (before == null) continue;

      const runs: BeforeRun[] = [];
      for (const { start, length } of entry.write.mask.runs()) {
        const values = new BigUint64Array(length);
        for (let i = 0; i < length; i++) {
          const value = before.get(start + i);
          if (value === undefined) {
            throw new Error(
              `beforeAccumulating is missing voxel ${start + i} of bucket ${key}, ` +
                "even though it was captured on first touch by the same writer.",
            );
          }
          values[i] = value;
        }
        runs.push({ start, length, values });
      }
      result.set(key, runs);
    }
    return result;
  }

  /**
   * Finalize: run mag propagation over the coalesced write set, apply the
   * derived mags to the cube, and build the diff.
   */
  commit(sequence: number, toolName: string): TransactionDiff {
    if (this.committed) throw new Error("Transaction already committed");
    this.committed = true;

    const perMag = propagate(this.bucketWrites, this.ctx, this.mags);

    // Every mag, source included. The source mag was already written through
    // during the interaction, but re-applying is idempotent (runs are absolute
    // writes) and covers the case where a fetch landed mid-stroke and replaced
    // the array before these writes were in the journal.
    for (const bucketWriteMap of perMag.values()) {
      for (const entry of bucketWriteMap.values()) {
        this.cube.applyWrites(entry.address, entry.write);
      }
    }

    const beforeCommittedByBucket = this.buildBeforeCommitted();
    const bucketDiffs = bucketDiffsOf(perMag.values());
    for (const diff of bucketDiffs) {
      const beforeCommitted = beforeCommittedByBucket.get(bucketKey(diff.address));
      if (beforeCommitted != null) diff.beforeCommitted = beforeCommitted;
    }

    return {
      id: this.id,
      sequence,
      sourceMagIndex: this.ctx.sourceMagIndex,
      toolName,
      bucketDiffs,
    };
  }

  /** Restore every touched resident bucket. Used to cancel an open stroke. */
  abort(): void {
    for (const [key, before] of this.beforeAccumulating) {
      const entry = this.bucketWrites.get(key);
      if (entry == null) continue;
      const data = this.cube.getResident(entry.address);
      if (data == null) continue;
      for (const [index, value] of before) data[index] = value;
    }
    this.bucketWrites.clear();
    this.beforeAccumulating.clear();
    this.committed = true;
  }

  /** Which mags a commit would touch. Exposed for tests. */
  previewMagIndices(): MagIndex[] {
    return [...propagate(this.bucketWrites, this.ctx, this.mags).keys()].sort((a, b) => a - b);
  }
}
