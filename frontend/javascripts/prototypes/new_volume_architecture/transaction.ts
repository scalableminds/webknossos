import { BucketVoxelMask } from "./bucket_voxel_mask";
import type { BucketWriteMap, BucketWriteMapEntry } from "./bucket_write_map";
import type { TransactionCube } from "./cube";
import { bucketDiffsOf, type TransactionDiff, type TransactionId } from "./diff";
import { propagate } from "./mag_propagation";
import {
  type BucketAddress,
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
    const isBackground = this.cube.backgroundProbe(address);

    return {
      isBackground,
      mark(index: VoxelIndex) {
        entry.write.mask.mark(index);
      },
      markRun(start: VoxelIndex, length: number) {
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

    return {
      id: this.id,
      sequence,
      sourceMagIndex: this.ctx.sourceMagIndex,
      toolName,
      bucketDiffs: bucketDiffsOf(perMag.values()),
    };
  }

  /**
   * Discard the open transaction. Used to cancel a stroke. Does not restore
   * buckets that were already painted live — that would need capturing
   * pre-transaction values (beforeAccumulating), which this iteration
   * intentionally leaves out along with the rest of undo support.
   */
  abort(): void {
    this.bucketWrites.clear();
    this.committed = true;
  }

  /** Which mags a commit would touch. Exposed for tests. */
  previewMagIndices(): MagIndex[] {
    return [...propagate(this.bucketWrites, this.ctx, this.mags).keys()].sort((a, b) => a - b);
  }
}
