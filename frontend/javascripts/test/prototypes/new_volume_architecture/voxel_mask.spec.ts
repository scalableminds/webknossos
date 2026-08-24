import {
  BUCKET_VOXEL_COUNT,
  BUCKET_WIDTH,
  VoxelMask,
  voxelIndexOf,
} from "prototypes/new_volume_architecture";
import { describe, expect, it } from "vitest";

function runsOf(mask: VoxelMask): Array<[number, number]> {
  return [...mask.runs()].map(({ start, length }) => [start, length]);
}

describe("new volume architecture — VoxelMask", () => {
  it("marks and reports single voxels", () => {
    const mask = new VoxelMask();
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
    const mask = new VoxelMask();
    mask.markRun(4, 8);
    expect(mask.count).toBe(8);
    expect(runsOf(mask)).toEqual([[4, 8]]);
    expect(mask.has(3)).toBe(false);
    expect(mask.has(4)).toBe(true);
    expect(mask.has(11)).toBe(true);
    expect(mask.has(12)).toBe(false);
  });

  it("marks a full 32-bit word without the 1<<32 wraparound", () => {
    const mask = new VoxelMask();
    mask.markRun(0, 32);
    expect(mask.count).toBe(32);
    expect(runsOf(mask)).toEqual([[0, 32]]);
  });

  it("splits runs at word boundaries, because a word is one x-row", () => {
    const mask = new VoxelMask();
    mask.markRun(30, 70); // crosses four words
    expect(mask.count).toBe(70);
    // Not [[30, 70]]: a run must never span rows, or mag propagation would
    // project it as a 70-voxel x-extent and streak across rows it never
    // touched. See VoxelMask.runs().
    expect(runsOf(mask)).toEqual([
      [30, 2],
      [32, 32],
      [64, 32],
      [96, 4],
    ]);
  });

  it("counts overlapping runs only once", () => {
    const mask = new VoxelMask();
    mask.markRun(10, 20);
    mask.markRun(15, 20); // overlaps 15..29
    expect(mask.count).toBe(25); // 10..34
    expect(runsOf(mask)).toEqual([
      [10, 22],
      [32, 3],
    ]);
  });

  it("merges adjacent runs and separates disjoint ones", () => {
    const mask = new VoxelMask();
    mask.markRun(0, 10);
    mask.markRun(10, 5); // abuts the previous run
    mask.markRun(40, 3); // disjoint
    expect(runsOf(mask)).toEqual([
      [0, 15],
      [40, 3],
    ]);
  });

  it("handles a run ending exactly at the last voxel", () => {
    const mask = new VoxelMask();
    mask.markRun(BUCKET_VOXEL_COUNT - 5, 5);
    expect(mask.count).toBe(5);
    expect(runsOf(mask)).toEqual([[BUCKET_VOXEL_COUNT - 5, 5]]);
  });

  it("rejects runs that would leave the bucket", () => {
    const mask = new VoxelMask();
    expect(() => mask.markRun(BUCKET_VOXEL_COUNT - 2, 5)).toThrow();
    expect(() => mask.markRun(-1, 2)).toThrow();
  });

  it("treats a word as exactly one x-row, so a scanline never straddles words", () => {
    // Row (y=1, z=0) occupies indices 32..63, i.e. word 1 in full.
    const mask = new VoxelMask();
    mask.markRun(voxelIndexOf(0, 1, 0), BUCKET_WIDTH);
    expect(runsOf(mask)).toEqual([[32, 32]]);
    expect(mask.has(voxelIndexOf(0, 0, 0))).toBe(false);
    expect(mask.has(voxelIndexOf(31, 1, 0))).toBe(true);
    expect(mask.has(voxelIndexOf(0, 2, 0))).toBe(false);
  });

  it("enumerates indices consistently with runs", () => {
    const mask = new VoxelMask();
    mask.markRun(5, 3);
    mask.mark(100);
    mask.markRun(200, 2);
    expect([...mask.indices()]).toEqual([5, 6, 7, 100, 200, 201]);
  });

  it("never yields a run that crosses a row, however the mask was filled", () => {
    // Fill several complete rows plus a partial one. Naively merging set bits
    // would collapse these into one enormous run.
    const mask = new VoxelMask();
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
    const mask = new VoxelMask();
    expect(runsOf(mask)).toEqual([]);
    expect([...mask.indices()]).toEqual([]);
  });
});
