import {
  BUCKET_VOXEL_COUNT,
  BUCKET_WIDTH,
  BucketVoxelMask,
  type RunAxis,
  voxelIndexOf,
} from "viewer/model/volumetracing/core";
import { describe, expect, it } from "vitest";

function runsOf(mask: BucketVoxelMask): Array<[number, number]> {
  return [...mask.runs()].map(({ start, length }) => [start, length]);
}

describe("volume annotation core — BucketVoxelMask", () => {
  it("marks and reports single voxels", () => {
    const mask = new BucketVoxelMask();
    expect(mask.count).toBe(0);
    expect(mask.has(0)).toBe(false);

    mask.mark(0);
    mask.mark(31);
    mask.mark(32);
    expect(mask.count).toBe(3);
    expect(mask.has(0)).toBe(true);
    expect(mask.has(31)).toBe(true);
    expect(mask.has(32)).toBe(true);
    expect(mask.has(1)).toBe(false);

    mask.mark(0); // idempotent, must not double-count
    expect(mask.count).toBe(3);
  });

  it("marks runs that stay inside one word", () => {
    const mask = new BucketVoxelMask();
    mask.markRun(4, 8);
    expect(mask.count).toBe(8);
    expect(runsOf(mask)).toEqual([[4, 8]]);
    expect(mask.has(3)).toBe(false);
    expect(mask.has(4)).toBe(true);
    expect(mask.has(11)).toBe(true);
    expect(mask.has(12)).toBe(false);
  });

  it("marks a full 32-bit word without the 1<<32 wraparound", () => {
    const mask = new BucketVoxelMask();
    mask.markRun(0, 32);
    expect(mask.count).toBe(32);
    expect(runsOf(mask)).toEqual([[0, 32]]);
  });

  it("splits runs at word boundaries, because a word is one x-row", () => {
    const mask = new BucketVoxelMask();
    mask.markRun(30, 70); // crosses four words
    expect(mask.count).toBe(70);
    // Not [[30, 70]]: a run must never span rows, or mag propagation would
    // project it as a 70-voxel x-extent and streak across rows it never
    // touched. See BucketVoxelMask.runs().
    expect(runsOf(mask)).toEqual([
      [30, 2],
      [32, 32],
      [64, 32],
      [96, 4],
    ]);
  });

  it("counts overlapping runs only once", () => {
    const mask = new BucketVoxelMask();
    mask.markRun(10, 20);
    mask.markRun(15, 20); // overlaps 15..29
    expect(mask.count).toBe(25); // 10..34
    expect(runsOf(mask)).toEqual([
      [10, 22],
      [32, 3],
    ]);
  });

  it("merges adjacent runs and separates disjoint ones", () => {
    const mask = new BucketVoxelMask();
    mask.markRun(0, 10);
    mask.markRun(10, 5); // abuts the previous run
    mask.markRun(40, 3); // disjoint
    expect(runsOf(mask)).toEqual([
      [0, 15],
      [40, 3],
    ]);
  });

  it("handles a run ending exactly at the last voxel", () => {
    const mask = new BucketVoxelMask();
    mask.markRun(BUCKET_VOXEL_COUNT - 5, 5);
    expect(mask.count).toBe(5);
    expect(runsOf(mask)).toEqual([[BUCKET_VOXEL_COUNT - 5, 5]]);
  });

  it("rejects runs that would leave the bucket", () => {
    const mask = new BucketVoxelMask();
    expect(() => mask.markRun(BUCKET_VOXEL_COUNT - 2, 5)).toThrow();
    expect(() => mask.markRun(-1, 2)).toThrow();
  });

  it("treats a word as exactly one x-row, so a scanline never straddles words", () => {
    // Row (y=1, z=0) occupies indices 32..63, i.e. word 1 in full.
    const mask = new BucketVoxelMask();
    mask.markRun(voxelIndexOf(0, 1, 0), BUCKET_WIDTH);
    expect(runsOf(mask)).toEqual([[32, 32]]);
    expect(mask.has(voxelIndexOf(0, 0, 0))).toBe(false);
    expect(mask.has(voxelIndexOf(31, 1, 0))).toBe(true);
    expect(mask.has(voxelIndexOf(0, 2, 0))).toBe(false);
  });

  it("enumerates indices consistently with runs", () => {
    const mask = new BucketVoxelMask();
    mask.markRun(5, 3);
    mask.mark(100);
    mask.markRun(200, 2);
    expect([...mask.indices()]).toEqual([5, 6, 7, 100, 200, 201]);
  });

  it("never yields a run that crosses a row, however the mask was filled", () => {
    // Fill several complete rows plus a partial one. Naively merging set bits
    // would collapse these into one enormous run.
    const mask = new BucketVoxelMask();
    mask.markRun(voxelIndexOf(0, 0, 0), BUCKET_WIDTH * 3 + 7);

    const runs = [...mask.runs()];
    expect(runs).toHaveLength(4);
    for (const { start, length } of runs) {
      const row = Math.floor(start / BUCKET_WIDTH);
      const lastRow = Math.floor((start + length - 1) / BUCKET_WIDTH);
      expect(lastRow).toBe(row);
    }
    expect(runs.reduce((sum, run) => sum + run.length, 0)).toBe(BUCKET_WIDTH * 3 + 7);
  });

  it("reports nothing for an empty mask", () => {
    const mask = new BucketVoxelMask();
    expect(runsOf(mask)).toEqual([]);
    expect([...mask.indices()]).toEqual([]);
    for (const axis of [0, 1, 2] as const) expect([...mask.orderedRuns(axis)]).toEqual([]);
  });

  describe("orderedRuns", () => {
    // Linear index of (x, y, z) in the order whose fastest axis is `axis`.
    const linearIndexOf = (x: number, y: number, z: number, axis: RunAxis) =>
      axis === 0
        ? x + 32 * y + 1024 * z
        : axis === 1
          ? y + 32 * z + 1024 * x
          : z + 32 * x + 1024 * y;

    // Reference: visit every voxel in linear order and merge adjacent ones.
    function naiveOrderedRuns(mask: BucketVoxelMask, axis: RunAxis): Array<[number, number]> {
      const set = new Uint8Array(BUCKET_VOXEL_COUNT);
      for (const index of mask.indices()) {
        const x = index % 32;
        const y = Math.floor(index / 32) % 32;
        const z = Math.floor(index / 1024);
        set[linearIndexOf(x, y, z, axis)] = 1;
      }
      const runs: Array<[number, number]> = [];
      for (let i = 0; i < BUCKET_VOXEL_COUNT; i++) {
        if (set[i] === 0) continue;
        const last = runs.at(-1);
        if (last != null && last[0] + last[1] === i) last[1]++;
        else runs.push([i, 1]);
      }
      return runs;
    }

    const orderedRunsOf = (mask: BucketVoxelMask, axis: RunAxis): Array<[number, number]> =>
      [...mask.orderedRuns(axis)].map(({ start, length }) => [start, length]);

    it("matches a voxel-by-voxel reference for random masks in every order", () => {
      let seed = 12345;
      const random = () => {
        seed = (seed * 1103515245 + 12345) >>> 0;
        return seed / 2 ** 32;
      };
      for (let trial = 0; trial < 20; trial++) {
        const mask = new BucketVoxelMask();
        // Sparse voxels, short runs and a few full rows, so that both the bit
        // scan and the all-ones fast path are exercised.
        for (let i = 0; i < 200; i++) mask.mark(Math.floor(random() * BUCKET_VOXEL_COUNT));
        for (let i = 0; i < 20; i++) {
          const row = Math.floor(random() * 1024);
          mask.markRun(row * 32, random() < 0.3 ? 32 : 1 + Math.floor(random() * 31));
        }
        for (const axis of [0, 1, 2] as const) {
          expect(orderedRunsOf(mask, axis)).toEqual(naiveOrderedRuns(mask, axis));
        }
      }
    });

    it("merges a full bucket into one run in every order", () => {
      const mask = new BucketVoxelMask();
      mask.markRun(0, BUCKET_VOXEL_COUNT);
      for (const axis of [0, 1, 2] as const) {
        expect(orderedRunsOf(mask, axis)).toEqual([[0, BUCKET_VOXEL_COUNT]]);
      }
    });

    it("makes a YZ slice one run in y order and an XZ slice one run in z order", () => {
      const yzSlice = new BucketVoxelMask();
      const xzSlice = new BucketVoxelMask();
      for (let a = 0; a < 32; a++) {
        for (let b = 0; b < 32; b++) {
          yzSlice.mark(voxelIndexOf(5, a, b));
          xzSlice.mark(voxelIndexOf(a, 5, b));
        }
      }
      expect(orderedRunsOf(yzSlice, 1)).toEqual([[5 * 1024, 1024]]);
      expect(orderedRunsOf(xzSlice, 2)).toEqual([[5 * 1024, 1024]]);
      // In x order, the YZ slice is one voxel per row.
      expect(orderedRunsOf(yzSlice, 0)).toHaveLength(1024);
    });
  });
});
