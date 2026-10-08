import {
  BUCKET_DIFF_FORMAT_VERSION,
  type BucketDiff,
  BucketVoxelMask,
  decodeBucketDiff,
  encodeBucketDiff,
  runAxisForPlane,
  type VoxelRun,
  voxelIndexOf,
} from "viewer/model/volumetracing/core";
import { encodeBucketDiffBase64 } from "viewer/model/volumetracing/core/bucket_diff";
import { describe, expect, it } from "vitest";

const ADDRESS = [0, 0, 0, 0, null] as unknown as BucketDiff["address"];

// A diff as the core produces it: the mask's per-row x-runs, one value.
function diffOf(indices: Iterable<number>, value = 7n): BucketDiff {
  const mask = new BucketVoxelMask();
  for (const index of indices) mask.mark(index);
  const runs: VoxelRun[] = [...mask.runs()].map(({ start, length }) => ({ start, length, value }));
  return { address: ADDRESS, runs };
}

// A disk of radius 10 around the bucket center in the plane with the given
// normal, one voxel thick, as a brush dab in that viewport.
function diskIndices(planeNormal: 0 | 1 | 2): number[] {
  const indices: number[] = [];
  for (let a = 0; a < 32; a++) {
    for (let b = 0; b < 32; b++) {
      if ((a - 16) ** 2 + (b - 16) ** 2 > 100) continue;
      const position = [a, b];
      position.splice(planeNormal, 0, 16);
      indices.push(voxelIndexOf(position[0], position[1], position[2]));
    }
  }
  return indices;
}

describe("volume annotation core — bucket diff encoding", () => {
  it("picks the run order whose two fastest axes span the viewport", () => {
    expect(runAxisForPlane(2)).toBe(0); // XY: x, y, z
    expect(runAxisForPlane(0)).toBe(1); // YZ: y, z, x
    expect(runAxisForPlane(1)).toBe(2); // XZ: z, x, y
  });

  it("round-trips in every run order", () => {
    for (const planeNormal of [0, 1, 2] as const) {
      const diff = diffOf(diskIndices(planeNormal), 2n ** 64n - 1n);
      for (const runAxis of [0, 1, 2] as const) {
        expect(decodeBucketDiff(encodeBucketDiff(diff, runAxis))).toEqual(diff.runs);
      }
    }
  });

  it("encodes a stroke as compactly in YZ and XZ as in XY, given the viewport's order", () => {
    const sizes = ([0, 1, 2] as const).map(
      (planeNormal) =>
        encodeBucketDiff(diffOf(diskIndices(planeNormal)), runAxisForPlane(planeNormal)).length,
    );
    expect(new Set(sizes).size).toBe(1);
    // In x order, the YZ disk is one run per voxel instead of one per row.
    expect(encodeBucketDiff(diffOf(diskIndices(0)), 0).length).toBeGreaterThan(sizes[0] * 10);
  });

  it("writes the header and varints as specified", () => {
    // A full bucket is one run: gap 0, length 32768 (varint 0x80 0x80 0x02).
    const full = diffOf(
      Array.from({ length: 32768 }, (_, i) => i),
      0x0102n,
    );
    expect([...encodeBucketDiff(full, 1)]).toEqual([
      BUCKET_DIFF_FORMAT_VERSION,
      1,
      ...[0x02, 0x01, 0, 0, 0, 0, 0, 0],
      1,
      0,
      0x80,
      0x80,
      0x02,
    ]);
    // The empty diff is the header plus a zero run count.
    expect(encodeBucketDiff({ address: ADDRESS, runs: [] })).toHaveLength(11);
  });

  it("rejects runs with mixed values", () => {
    const diff: BucketDiff = {
      address: ADDRESS,
      runs: [
        { start: 0, length: 1, value: 1n },
        { start: 5, length: 1, value: 2n },
      ],
    };
    expect(() => encodeBucketDiff(diff)).toThrow(/mixed values/);
  });

  it("rejects malformed buffers when decoding", () => {
    const valid = encodeBucketDiff(diffOf([1, 2, 40]));
    const withVersion = Uint8Array.from(valid);
    withVersion[0] = BUCKET_DIFF_FORMAT_VERSION + 1;
    expect(() => decodeBucketDiff(withVersion)).toThrow(/version/);
    expect(() => decodeBucketDiff(valid.subarray(0, valid.length - 1))).toThrow(/Truncated/);
    expect(() => decodeBucketDiff(Uint8Array.from([...valid, 0]))).toThrow(/Trailing/);
  });

  it("produces the same bytes in base64", () => {
    const diff = diffOf(diskIndices(1));
    const bytes = encodeBucketDiff(diff, 2);
    expect(Uint8Array.from(atob(encodeBucketDiffBase64(diff, 2)), (c) => c.charCodeAt(0))).toEqual(
      bytes,
    );
  });
});
