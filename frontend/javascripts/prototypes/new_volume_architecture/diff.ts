import type { BucketAddress, MagIndex, SegmentId, VoxelIndex } from "./types";
import type { BucketWrites, VoxelWriteSet } from "./write_set";

/**
 * A run of consecutive voxel indices sharing one value. Every run a transaction
 * produces is constant-valued, because transactions are single-valued.
 */
export interface VoxelRun {
  start: VoxelIndex;
  length: number;
  value: SegmentId;
}

export interface BucketDiff {
  address: BucketAddress;
  runs: VoxelRun[];
}

export type TransactionId = string;

export interface TransactionDiff {
  id: TransactionId;
  /** Monotonic per client; the merge key in a future collaborative mode. */
  sequence: number;
  /** The mag the user authored at; every other mag's diffs are resampled. */
  sourceMagIndex: MagIndex;
  toolName: string;
  bucketDiffs: BucketDiff[];
}

/**
 * Extract runs from a bucket's writes. A word scan over the mask — no sort and
 * no per-voxel value lookup, because the value is held once for the bucket.
 */
export function toRuns(writes: BucketWrites): VoxelRun[] {
  const runs: VoxelRun[] = [];
  for (const { start, length } of writes.mask.runs()) {
    runs.push({ start, length, value: writes.value });
  }
  return runs;
}

/** Apply one run to a dense bucket array. Absolute writes, hence idempotent. */
export function applyRun(data: BigUint64Array, run: VoxelRun): void {
  data.fill(run.value, run.start, run.start + run.length);
}

export function bucketDiffsOf(writeSets: Iterable<VoxelWriteSet>): BucketDiff[] {
  const diffs: BucketDiff[] = [];
  for (const writeSet of writeSets) {
    for (const entry of writeSet.values()) {
      if (entry.writes.mask.count === 0) continue;
      diffs.push({ address: entry.address, runs: toRuns(entry.writes) });
    }
  }
  return diffs;
}

/** Total voxels a diff touches. Used by tests. */
export function countDiffVoxels(diff: TransactionDiff): number {
  let total = 0;
  for (const bucketDiff of diff.bucketDiffs) {
    for (const run of bucketDiff.runs) total += run.length;
  }
  return total;
}

/**
 * Binary run encoding, little-endian. Every run in a bucket carries the same
 * value, so the value is hoisted into the header and a run is just 4 bytes:
 *
 *   uint64  value
 *   uint32  runCount
 *   repeat: uint16 startIndex, uint16 length
 *
 * Encoded through a DataView because the field widths are mixed and DataView
 * takes an explicit littleEndian flag, so the format does not silently inherit
 * the platform's byte order.
 */
export function encodeBucketDiff(diff: BucketDiff): Uint8Array {
  const value = diff.runs.length > 0 ? diff.runs[0].value : 0n;
  const buffer = new ArrayBuffer(8 + 4 + diff.runs.length * 4);
  const view = new DataView(buffer);
  view.setBigUint64(0, value, true);
  view.setUint32(8, diff.runs.length, true);
  let offset = 12;
  for (const run of diff.runs) {
    view.setUint16(offset, run.start, true);
    view.setUint16(offset + 2, run.length, true);
    offset += 4;
  }
  return new Uint8Array(buffer);
}

export function decodeBucketDiff(bytes: Uint8Array): VoxelRun[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const value = view.getBigUint64(0, true);
  const runCount = view.getUint32(8, true);
  const runs: VoxelRun[] = [];
  for (let i = 0; i < runCount; i++) {
    const offset = 12 + i * 4;
    runs.push({
      start: view.getUint16(offset, true),
      length: view.getUint16(offset + 2, true),
      value,
    });
  }
  return runs;
}
