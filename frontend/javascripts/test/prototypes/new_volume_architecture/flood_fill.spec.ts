import {
  type BucketAddress,
  countDiffVoxels,
  type SegmentId,
  type Vector3,
  voxelIndexOf,
} from "prototypes/new_volume_architecture";
import { describe, expect, it } from "vitest";
import {
  bucketOf,
  createHarness,
  editContext,
  keyOf,
  MAGS,
  magIndicesOf,
  materialize,
  toMagVoxel,
  voxelsInBox,
} from "./helpers";

const EXISTING: SegmentId = 3n;
const FILL: SegmentId = 9n;

/**
 * A rectangle of `EXISTING` that straddles the x=32 bucket boundary, so the
 * traversal is forced to cross into a second bucket and fetch it.
 */
const REGION_MIN: Vector3 = [28, 10, 3];
const REGION_MAX: Vector3 = [37, 15, 4]; // exclusive; single z-slice

function seedRegion(backend: { seedVoxel: (a: BucketAddress, o: Vector3, v: SegmentId) => void }) {
  for (const voxel of voxelsInBox(REGION_MIN, REGION_MAX)) {
    const address = bucketOf(voxel, 0);
    backend.seedVoxel(address, [voxel[0] % 32, voxel[1] % 32, voxel[2] % 32], EXISTING);
  }
}

function regionKeys(): Set<string> {
  const keys = new Set<string>();
  for (const voxel of voxelsInBox(REGION_MIN, REGION_MAX)) keys.add(keyOf(voxel));
  return keys;
}

describe("new volume architecture — flood fill", () => {
  it("fills exactly the connected region, across bucket boundaries", async () => {
    const { cube, session, backend } = createHarness();
    seedRegion(backend);

    // Coarser mags must be resident to be read back; the fill loads mag 0
    // itself as it traverses.
    await materialize(cube, [
      [0, 0, 0, 1],
      [0, 0, 0, 2],
    ]);

    const ctx = editContext({ sourceMagIndex: 0, activeSegmentId: FILL });
    const diff = await session.floodFill(
      { kind: "floodFill", seed: [30, 12, 3], is3D: false, bounds: null },
      ctx,
    );

    const expected = regionKeys();

    // Everything in the region is filled...
    for (const key of expected) {
      const voxel = key.split(",").map(Number) as Vector3;
      expect(cube.peek(voxel, 0)).toBe(FILL);
    }
    // ...and nothing outside it is, including the immediate ring.
    for (const voxel of voxelsInBox([25, 7, 2], [42, 19, 6])) {
      if (expected.has(keyOf(voxel))) continue;
      expect(cube.peek(voxel, 0) ?? 0n).toBe(0n);
    }

    // The traversal genuinely crossed a bucket boundary.
    const fetchedKeys = backend.fetched.map((address) => address.join(","));
    expect(fetchedKeys).toContain("0,0,0,0");
    expect(fetchedKeys).toContain("1,0,0,0");

    // One transaction, covering every mag.
    expect(session.emitted).toHaveLength(1);
    expect(diff.toolName).toBe("floodFill");
    expect(diff.sourceMagIndex).toBe(0);
    expect(magIndicesOf(diff.bucketDiffs.map((d) => d.address))).toEqual([0, 1, 2]);

    // The mag-0 diff describes exactly the region, split across two buckets.
    const mag0 = diff.bucketDiffs.filter((d) => d.address[3] === 0);
    expect(mag0).toHaveLength(2);
    const mag0Voxels = mag0.flatMap((d) => d.runs).reduce((sum, run) => sum + run.length, 0);
    expect(mag0Voxels).toBe(expected.size);
    for (const bucketDiff of diff.bucketDiffs) {
      for (const run of bucketDiff.runs) expect(run.value).toBe(FILL);
    }
  });

  it("propagates the filled region to the coarser mags", async () => {
    const { cube, session, backend } = createHarness();
    seedRegion(backend);
    await materialize(cube, [
      [0, 0, 0, 1],
      [0, 0, 0, 2],
    ]);

    await session.floodFill(
      { kind: "floodFill", seed: [30, 12, 3], is3D: false, bounds: null },
      editContext({ activeSegmentId: FILL }),
    );

    for (const voxel of voxelsInBox(REGION_MIN, REGION_MAX)) {
      for (let magIndex = 1; magIndex < MAGS.length; magIndex++) {
        const mag = MAGS.get(magIndex);
        expect(cube.peek(toMagVoxel(voxel, mag), magIndex)).toBe(FILL);
      }
    }
  });

  it("respects a bounding box, stopping the traversal early", async () => {
    const { cube, session, backend } = createHarness();
    seedRegion(backend);

    const diff = await session.floodFill(
      {
        kind: "floodFill",
        seed: [30, 12, 3],
        is3D: false,
        // Clip to the left of the bucket boundary.
        bounds: { min: [0, 0, 0], max: [32, 64, 64] },
      },
      editContext({ activeSegmentId: FILL }),
    );

    // Left of the boundary is filled, right of it is untouched.
    expect(cube.peek([31, 12, 3], 0)).toBe(FILL);
    await cube.materialize([1, 0, 0, 0]);
    expect(cube.peek([32, 12, 3], 0)).toBe(EXISTING);

    const mag0 = diff.bucketDiffs.filter((d) => d.address[3] === 0);
    expect(mag0).toHaveLength(1);
    expect(mag0[0].address).toEqual([0, 0, 0, 0]);
    // 4 columns (28..31) × 5 rows (10..14) × 1 slice
    expect(countDiffVoxels({ ...diff, bucketDiffs: mag0 })).toBe(4 * 5);
  });

  it("does nothing when the seed already carries the active segment id", async () => {
    const { session, backend } = createHarness();
    seedRegion(backend);

    const diff = await session.floodFill(
      { kind: "floodFill", seed: [30, 12, 3], is3D: false, bounds: null },
      editContext({ activeSegmentId: EXISTING }),
    );

    expect(diff.bucketDiffs).toHaveLength(0);
    expect(countDiffVoxels(diff)).toBe(0);
  });

  it("fills through a 3D region only when is3D is set", async () => {
    const { cube, session, backend } = createHarness();
    // Two stacked slices of the same value.
    for (const voxel of voxelsInBox([10, 10, 5], [14, 14, 7])) {
      backend.seedVoxel(bucketOf(voxel, 0), [voxel[0], voxel[1], voxel[2]], EXISTING);
    }
    await materialize(cube, [[0, 0, 0, 0]]);

    await session.floodFill(
      { kind: "floodFill", seed: [11, 11, 5], is3D: false, bounds: null },
      editContext({ activeSegmentId: FILL }),
    );
    expect(cube.peek([11, 11, 5], 0)).toBe(FILL);
    expect(cube.peek([11, 11, 6], 0)).toBe(EXISTING); // 2D fill stayed in-plane

    await session.floodFill(
      { kind: "floodFill", seed: [11, 11, 6], is3D: true, bounds: null },
      editContext({ activeSegmentId: FILL }),
    );
    expect(cube.peek([11, 11, 6], 0)).toBe(FILL);
  });

  it("writes the mask through to the bucket data verbatim", async () => {
    const { cube, session, backend } = createHarness();
    seedRegion(backend);
    await materialize(cube, [[0, 0, 0, 0]]);

    await session.floodFill(
      {
        kind: "floodFill",
        seed: [30, 12, 3],
        is3D: false,
        bounds: { min: [0, 0, 0], max: [32, 64, 64] },
      },
      editContext({ activeSegmentId: FILL }),
    );

    // Spot-check the raw array rather than going through peek().
    const data = cube.getResident([0, 0, 0, 0]);
    expect(data).toBeDefined();
    expect(data?.[voxelIndexOf(28, 10, 3)]).toBe(FILL);
    expect(data?.[voxelIndexOf(31, 14, 3)]).toBe(FILL);
    expect(data?.[voxelIndexOf(27, 10, 3)]).toBe(0n); // just outside
  });
});
