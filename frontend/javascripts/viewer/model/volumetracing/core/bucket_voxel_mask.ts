import { BUCKET_VOXEL_COUNT, BUCKET_WIDTH, type VoxelIndex } from "./volume_annotation_types";

const WORD_BITS = 32;
const WORD_COUNT = BUCKET_VOXEL_COUNT / WORD_BITS; // 1024

/**
 * One bit per voxel of a bucket: 32_768 bits = 1024 words = 4 KB.
 *
 * A "word" is one Uint32 holding the flags of 32 consecutive voxels, so voxel
 * `i` lives at bit `i & 31` (i.e. `i % 32`) of word `i >>> 5` (i.e.
 * `floor(i / 32)`).
 *
 * Because a flat voxel index is `x + y*32 + z*1024` and BUCKET_WIDTH is also
 * 32, a word is exactly one x-row of the bucket. A scanline therefore never
 * straddles a word boundary, which is what makes markRun cheap.
 */
export class BucketVoxelMask {
  private readonly words = new Uint32Array(WORD_COUNT);
  private markedCount = 0;

  get count(): number {
    return this.markedCount;
  }

  has(index: VoxelIndex): boolean {
    return (this.words[index >>> 5] & (1 << (index & 31))) !== 0;
  }

  mark(index: VoxelIndex): void {
    const word = index >>> 5;
    const bit = 1 << (index & 31);
    if ((this.words[word] & bit) === 0) {
      this.words[word] |= bit;
      this.markedCount++;
    }
  }

  /**
   * Mark `length` consecutive indices starting at `start`. Since a word is one
   * x-row, a run that stays inside a row touches exactly one word.
   */
  markRun(start: VoxelIndex, length: number): void {
    if (length <= 0) return;
    const end = start + length; // exclusive
    if (start < 0 || end > BUCKET_VOXEL_COUNT) {
      throw new Error(`markRun out of bounds: ${start}..${end}`);
    }

    let index = start;
    while (index < end) {
      const word = index >>> 5;
      const bitOffset = index & 31;
      const bitsHere = Math.min(WORD_BITS - bitOffset, end - index);
      // Mask of `bitsHere` bits starting at bitOffset. Built via division to
      // avoid the 1<<32 === 1 wraparound when bitsHere is 32.
      const spanMask = (bitsHere === WORD_BITS ? 0xffffffff : (1 << bitsHere) - 1) << bitOffset;
      const before = this.words[word];
      const after = before | spanMask;
      if (after !== before) {
        this.markedCount += popcount32(after & ~before);
        this.words[word] = after;
      }
      index += bitsHere;
    }
  }

  /**
   * Ascending runs of set bits, found by scanning words.
   *
   * Runs never cross a word boundary, and since a word is exactly one x-row
   * (see above) that means **every run is an x-run**. Callers rely on this:
   * mag propagation multiplies and divides a run's length as an x-extent, and
   * merging two full rows into one 64-long "run" would make it project into a
   * horizontal streak spanning rows it never touched.
   *
   * The cost is that a solid bucket yields 1024 runs rather than 1. The wire
   * encoding uses `orderedRuns` instead, which merges runs.
   */
  *runs(): Generator<{ start: VoxelIndex; length: number }> {
    for (let word = 0; word < WORD_COUNT; word++) {
      const value = this.words[word];
      if (value === 0) continue;
      const base = word * WORD_BITS;
      let runStart = -1;
      for (let bit = 0; bit < WORD_BITS; bit++) {
        const index = base + bit;
        if ((value & (1 << bit)) !== 0) {
          if (runStart < 0) runStart = index;
        } else if (runStart >= 0) {
          yield { start: runStart, length: index - runStart };
          runStart = -1;
        }
      }
      if (runStart >= 0) {
        yield { start: runStart, length: base + WORD_BITS - runStart };
      }
    }
  }

  /**
   * Runs in the order whose fastest axis is `fastAxis` (0 = x,y,z; 1 = y,z,x;
   * 2 = z,x,y), merged across rows and slices. `start` is a linear index in
   * that order, not a flat bucket index. Only for the wire encoding (§11.2):
   * the other two orders are the ones in which a YZ or XZ stroke is
   * contiguous, as an XY stroke is in x order.
   */
  *orderedRuns(fastAxis: RunAxis): Generator<{ start: number; length: number }> {
    const words = fastAxis === 0 ? this.words : transposedWords(this.words, fastAxis);
    let runStart = -1;
    for (let word = 0; word < WORD_COUNT; word++) {
      const value = words[word];
      const base = word * WORD_BITS;
      if (value === 0 || value === 0xffffffff) {
        if (value === 0 && runStart >= 0) {
          yield { start: runStart, length: base - runStart };
          runStart = -1;
        } else if (value !== 0 && runStart < 0) {
          runStart = base;
        }
        continue;
      }
      for (let bit = 0; bit < WORD_BITS; bit++) {
        const index = base + bit;
        if ((value & (1 << bit)) !== 0) {
          if (runStart < 0) runStart = index;
        } else if (runStart >= 0) {
          yield { start: runStart, length: index - runStart };
          runStart = -1;
        }
      }
    }
    if (runStart >= 0) yield { start: runStart, length: BUCKET_VOXEL_COUNT - runStart };
  }

  /** Debug helper: every marked index, ascending. */
  *indices(): Generator<VoxelIndex> {
    for (const { start, length } of this.runs()) {
      for (let i = start; i < start + length; i++) yield i;
    }
  }
}

/** The fastest axis of a run order; the other two follow cyclically. */
export type RunAxis = 0 | 1 | 2;

/**
 * The mask's words re-laid out for the order starting at `fastAxis`, so that
 * word `w` holds that order's linear indices `32w` to `32w + 31`. Each 32×32
 * slice is a bit-matrix transpose:
 *
 * - y order (y + 32z + 1024x): per z-slice, rows y with bits x become words
 *   z + 32x with bits y.
 * - z order (z + 32x + 1024y): per y-slice, rows z with bits x become words
 *   x + 32y with bits z.
 */
function transposedWords(words: Uint32Array, fastAxis: 1 | 2): Uint32Array {
  const out = new Uint32Array(WORD_COUNT);
  const block = new Uint32Array(BUCKET_WIDTH);
  for (let slice = 0; slice < BUCKET_WIDTH; slice++) {
    let any = 0;
    for (let row = 0; row < BUCKET_WIDTH; row++) {
      // fastAxis 1: slice = z, row = y. fastAxis 2: slice = y, row = z.
      const value = fastAxis === 1 ? words[row + slice * 32] : words[slice + row * 32];
      block[row] = value;
      any |= value;
    }
    if (any === 0) continue;
    transpose32(block);
    for (let x = 0; x < BUCKET_WIDTH; x++) {
      out[fastAxis === 1 ? slice + x * 32 : x + slice * 32] = block[x];
    }
  }
  return out;
}

/**
 * In-place transpose of a 32×32 bit matrix, where bit c of `rows[r]` is entry
 * (r, c): afterwards, bit r of `rows[c]` is. Swaps ever smaller off-diagonal
 * blocks (16, 8, …, 1), as in Hacker's Delight, adapted to LSB-first bits.
 */
function transpose32(rows: Uint32Array): void {
  let mask = 0x0000ffff;
  for (let size = 16; size !== 0; size >>= 1, mask ^= mask << size) {
    for (let k = 0; k < 32; k = (k + size + 1) & ~size) {
      const swap = ((rows[k] >>> size) ^ rows[k + size]) & mask;
      rows[k] ^= swap << size;
      rows[k + size] ^= swap;
    }
  }
}

/** Number of x-rows per bucket; exported for tests that reason about layout. */
export const ROWS_PER_BUCKET = BUCKET_VOXEL_COUNT / BUCKET_WIDTH;

/** Counts the set bits in a 32-bit value (population count), via SWAR bit-tricks. */
function popcount32(value: number): number {
  let v = value - ((value >>> 1) & 0x55555555);
  v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
  v = (v + (v >>> 4)) & 0x0f0f0f0f;
  return (v * 0x01010101) >>> 24;
}
