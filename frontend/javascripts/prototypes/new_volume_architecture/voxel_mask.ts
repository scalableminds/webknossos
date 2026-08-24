import { BUCKET_VOXEL_COUNT, BUCKET_WIDTH, type VoxelIndex } from "./types";

const WORD_BITS = 32;
const WORD_COUNT = BUCKET_VOXEL_COUNT / WORD_BITS; // 1024

/**
 * One bit per voxel of a bucket: 32_768 bits = 1024 words = 4 KB.
 *
 * A "word" is one Uint32 holding the flags of 32 consecutive voxels, so voxel
 * `i` lives at bit `i & 31` of word `i >>> 5`.
 *
 * Because a flat voxel index is `x + y*32 + z*1024` and BUCKET_WIDTH is also
 * 32, a word is exactly one x-row of the bucket. A scanline therefore never
 * straddles a word boundary, which is what makes markRun cheap.
 */
export class VoxelMask {
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
   * The cost is that a solid bucket yields 1024 runs rather than 1. Worth it;
   * a merged-run variant for the wire encoding can be added separately if the
   * size ever matters.
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

  /** Debug helper: every marked index, ascending. */
  *indices(): Generator<VoxelIndex> {
    for (const { start, length } of this.runs()) {
      for (let i = start; i < start + length; i++) yield i;
    }
  }
}

/** Number of x-rows per bucket; exported for tests that reason about layout. */
export const ROWS_PER_BUCKET = BUCKET_VOXEL_COUNT / BUCKET_WIDTH;

function popcount32(value: number): number {
  let v = value - ((value >>> 1) & 0x55555555);
  v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
  v = (v + (v >>> 4)) & 0x0f0f0f0f;
  return (v * 0x01010101) >>> 24;
}
