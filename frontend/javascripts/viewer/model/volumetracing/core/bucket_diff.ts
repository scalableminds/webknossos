import { BucketVoxelMask, type RunAxis } from "./bucket_voxel_mask";
import type { BucketWrite, BucketWriteMap } from "./bucket_write_map";
import {
  BUCKET_VOXEL_COUNT,
  type BucketAddress,
  type MagIndex,
  type SegmentBucketData,
  type SegmentId,
  type VoxelIndex,
} from "./volume_annotation_types";

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
export function toRuns(write: BucketWrite): VoxelRun[] {
  const runs: VoxelRun[] = [];
  for (const { start, length } of write.mask.runs()) {
    runs.push({ start, length, value: write.value });
  }
  return runs;
}

/**
 * Apply one run to a bucket array of any segmentation element class. Absolute
 * writes, hence idempotent. `run.value` is a SegmentId and therefore always a
 * bigint, so a non-64-bit array needs it converted.
 */
export function applyRun(data: SegmentBucketData, run: VoxelRun): void {
  if (data instanceof BigUint64Array || data instanceof BigInt64Array) {
    data.fill(run.value, run.start, run.start + run.length);
    return;
  }
  (data as Uint32Array).fill(Number(run.value), run.start, run.start + run.length);
}

export function bucketDiffsOf(bucketWriteMaps: Iterable<BucketWriteMap>): BucketDiff[] {
  const diffs: BucketDiff[] = [];
  for (const bucketWriteMap of bucketWriteMaps) {
    for (const entry of bucketWriteMap.values()) {
      if (entry.write.mask.count === 0) continue;
      diffs.push({ address: entry.address, runs: toRuns(entry.write) });
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

/** Version byte of the run encoding below; increment it when changing the format. */
export const BUCKET_DIFF_FORMAT_VERSION = 1;

/**
 * The run order in which a stroke drawn in a viewport is contiguous: the one
 * whose two fastest axes span the viewport (x,y,z for XY, y,z,x for YZ,
 * z,x,y for XZ). `planeNormal` is the viewport normal (0 = YZ, 1 = XZ, 2 = XY).
 */
export function runAxisForPlane(planeNormal: 0 | 1 | 2): RunAxis {
  return ((planeNormal + 1) % 3) as RunAxis;
}

/**
 * Binary run encoding (§11.2), little-endian:
 *
 *   uint8   formatVersion   BUCKET_DIFF_FORMAT_VERSION
 *   uint8   runAxis         fastest axis of the run order, see RunAxis
 *   uint64  value
 *   varint  runCount
 *   repeat: varint gap, varint length
 *
 * Every run in a bucket carries the same value, so the value is in the
 * header. Runs are over the linear index of the run order and may cross rows
 * and slices; `gap` is the distance from the previous run's end (or from 0).
 * Varints are unsigned LEB128: 7 bits per byte, low bits first.
 *
 * `runAxis` only changes the size, not the voxels: pick the order in which the
 * stroke is contiguous (runAxisForPlane), and a YZ stroke costs no more than an
 * XY one.
 */
export function encodeBucketDiff(diff: BucketDiff, runAxis: RunAxis = 0): Uint8Array {
  const value = diff.runs.length > 0 ? diff.runs[0].value : 0n;
  const mask = new BucketVoxelMask();
  for (const run of diff.runs) {
    if (run.value !== value) {
      // The header holds one value for the whole bucket, so a mixed-value diff
      // would silently serialize every run with the first one's value. A
      // BucketDiff must come from a single transaction, which §4 guarantees is
      // single-valued; producing one by merging transactions is the bug.
      throw new Error(
        `encodeBucketDiff got runs with mixed values (${value} and ${run.value}). ` +
          "A BucketDiff must cover exactly one transaction.",
      );
    }
    mask.markRun(run.start, run.length);
  }
  const runs = [...mask.orderedRuns(runAxis)];

  // Gap and length are at most 32_768, so at most 3 varint bytes each.
  const bytes = new Uint8Array(2 + 8 + 5 + runs.length * 6);
  const view = new DataView(bytes.buffer);
  bytes[0] = BUCKET_DIFF_FORMAT_VERSION;
  bytes[1] = runAxis;
  view.setBigUint64(2, BigInt.asUintN(64, value), true);
  let offset = writeVarint(bytes, 10, runs.length);
  let previousEnd = 0;
  for (const run of runs) {
    offset = writeVarint(bytes, offset, run.start - previousEnd);
    offset = writeVarint(bytes, offset, run.length);
    previousEnd = run.start + run.length;
  }
  return bytes.slice(0, offset);
}

function writeVarint(bytes: Uint8Array, offset: number, value: number): number {
  let rest = value;
  while (rest >= 0x80) {
    bytes[offset++] = (rest & 0x7f) | 0x80;
    rest >>>= 7;
  }
  bytes[offset++] = rest;
  return offset;
}

/**
 * Base64 of `encodeBucketDiff`'s bytes, ready to go straight into an
 * `updateBucketPartial` update action. Converted in chunks, because spreading
 * a scattered bucket's tens of kilobytes into one fromCharCode call could
 * exceed the engine's argument limit.
 */
export function encodeBucketDiffBase64(diff: BucketDiff, runAxis: RunAxis = 0): string {
  const bytes = encodeBucketDiff(diff, runAxis);
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x2000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x2000));
  }
  return btoa(binary);
}

/**
 * Reference decoder, the counterpart of the backend's applyVoxelRuns. Returns
 * the diff as flat per-row runs, i.e. exactly what `toRuns` produced before
 * encoding, whatever the run order.
 */
export function decodeBucketDiff(bytes: Uint8Array): VoxelRun[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes[0] !== BUCKET_DIFF_FORMAT_VERSION) {
    throw new Error(`Unknown bucket diff format version ${bytes[0]}.`);
  }
  const runAxis = bytes[1];
  if (runAxis > 2) throw new Error(`Unknown run axis ${runAxis}.`);
  const value = view.getBigUint64(2, true);
  let offset = 10;
  const readVarint = (): number => {
    let result = 0;
    for (let shift = 0; ; shift += 7) {
      if (offset >= bytes.length) throw new Error("Truncated bucket diff.");
      const byte = bytes[offset++];
      result += (byte & 0x7f) * 2 ** shift;
      if ((byte & 0x80) === 0) return result;
    }
  };

  const mask = new BucketVoxelMask();
  const runCount = readVarint();
  let linear = 0;
  for (let i = 0; i < runCount; i++) {
    linear += readVarint();
    const end = linear + readVarint();
    if (end > BUCKET_VOXEL_COUNT) throw new Error("Bucket diff run exceeds the bucket.");
    for (; linear < end; linear++) mask.mark(flatIndexOf(linear, runAxis as RunAxis));
  }
  if (offset !== bytes.length) throw new Error("Trailing bytes after bucket diff.");

  const runs: VoxelRun[] = [];
  for (const { start, length } of mask.runs()) runs.push({ start, length, value });
  return runs;
}

/** Maps a linear index of the run order starting at `runAxis` to a flat bucket index. */
function flatIndexOf(linear: number, runAxis: RunAxis): VoxelIndex {
  const fast = linear & 31;
  const middle = (linear >>> 5) & 31;
  const slow = linear >>> 10;
  // (fast, middle, slow) is (x, y, z), (y, z, x) or (z, x, y).
  if (runAxis === 0) return linear;
  if (runAxis === 1) return slow + fast * 32 + middle * 1024;
  return middle + slow * 32 + fast * 1024;
}
