import type { TransactionCube } from "./cube";
import { bucketDiffsOf, type TransactionDiff, type TransactionId } from "./diff";
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
import { VoxelMask } from "./voxel_mask";
import type { VoxelWriteSet, WriteSetEntry } from "./write_set";

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
  private readonly writes: VoxelWriteSet = new Map();
  /** Pre-transaction values, first touch only, resident buckets only. */
  private readonly beforeAccumulating = new Map<BucketKey, Map<VoxelIndex, SegmentId>>();
  private committed = false;

  constructor(
    readonly id: TransactionId,
    readonly ctx: EditContext,
    private readonly cube: TransactionCube,
    private readonly mags: MagList,
  ) {}

  private entryFor(address: BucketAddress, value: SegmentId): WriteSetEntry {
    const key = bucketKey(address);
    let entry = this.writes.get(key);
    if (entry == null) {
      entry = { address, writes: { mask: new VoxelMask(), value } };
      this.writes.set(key, entry);
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
        entry.writes.mask.mark(index);
      },
      markRun(start: VoxelIndex, length: number) {
        // todop: can we make this more efficient?
        for (let i = start; i < start + length; i++) captureBefore(i);
        entry.writes.mask.markRun(start, length);
      },
    };
  }

  /** Merge a whole write set (from the resolver, or a remote peer). */
  // todop: could this be cheaper in case the current transaction is empty?
  recordAll(writeSet: VoxelWriteSet): void {
    for (const incoming of writeSet.values()) {
      const writer = this.writerFor(incoming.address, incoming.writes.value);
      for (const { start, length } of incoming.writes.mask.runs()) {
        writer.markRun(start, length);
      }
    }
  }

  /** Push accumulated source-mag writes into the cube for live feedback. */
  flushToCube(): void {
    for (const entry of this.writes.values()) {
      this.cube.applyWrites(entry.address, entry.writes);
    }
  }

  get sourceWrites(): VoxelWriteSet {
    return this.writes;
  }

  /**
   * Finalize: run mag propagation over the coalesced write set, apply the
   * derived mags to the cube, and build the diff.
   */
  commit(sequence: number, toolName: string): TransactionDiff {
    if (this.committed) throw new Error("Transaction already committed");
    this.committed = true;

    const perMag = propagate(this.writes, this.ctx, this.mags);

    // Every mag, source included. The source mag was already written through
    // during the interaction, but re-applying is idempotent (runs are absolute
    // writes) and covers the case where a fetch landed mid-stroke and replaced
    // the array before these writes were in the journal.
    for (const writeSet of perMag.values()) {
      for (const entry of writeSet.values()) {
        this.cube.applyWrites(entry.address, entry.writes);
      }
    }

    return {
      id: this.id,
      sequence,
      sourceMagIndex: this.ctx.sourceMagIndex,
      toolName,
      bucketDiffs: bucketDiffsOf(perMag.values()),
    };
  }

  /** Restore every touched resident bucket. Used to cancel an open stroke. */
  abort(): void {
    for (const [key, before] of this.beforeAccumulating) {
      const entry = this.writes.get(key);
      if (entry == null) continue;
      const data = this.cube.getResident(entry.address);
      if (data == null) continue;
      for (const [index, value] of before) data[index] = value;
    }
    this.writes.clear();
    this.beforeAccumulating.clear();
    this.committed = true;
  }

  /** Which mags a commit would touch. Exposed for tests. */
  previewMagIndices(): MagIndex[] {
    return [...propagate(this.writes, this.ctx, this.mags).keys()].sort((a, b) => a - b);
  }
}
