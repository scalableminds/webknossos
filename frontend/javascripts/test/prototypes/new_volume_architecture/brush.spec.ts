import {
  type BucketAddress,
  countDiffVoxels,
  decodeBucketDiff,
  encodeBucketDiff,
  type SegmentId,
  type Vector3,
} from "prototypes/new_volume_architecture";
import { describe, expect, it } from "vitest";
import {
  createHarness,
  editContext,
  keyOf,
  MAGS,
  magIndicesOf,
  materialize,
  originBuckets,
  paintedVoxels,
  toMagVoxel,
  voxelsInBox,
} from "./helpers";

const SEGMENT: SegmentId = 7n;

/**
 * Reference implementation of the brush region, deliberately written the naive
 * way: no buckets, no masks, no runs. The pipeline under test has to agree with
 * it, which is what makes the bucket-splitting and run-encoding meaningful.
 */
function referenceStroke(path: Vector3[], radius: number, planeAxis: 0 | 1 | 2): Set<string> {
  const slice = Math.floor(path[0][planeAxis]);
  const painted = new Set<string>();
  const axes = [0, 1, 2].filter((axis) => axis !== planeAxis);

  for (const voxel of voxelsInBox([0, 0, 0], [64, 64, 32])) {
    if (voxel[planeAxis] !== slice) continue;
    let inside = false;
    for (let i = 0; i < Math.max(1, path.length - 1); i++) {
      const from = path[i];
      const to = path[Math.min(i + 1, path.length - 1)];
      let dot = 0;
      let lengthSquared = 0;
      for (const axis of axes) {
        const d = to[axis] - from[axis];
        dot += (voxel[axis] + 0.5 - from[axis]) * d;
        lengthSquared += d * d;
      }
      const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, dot / lengthSquared));
      let distanceSquared = 0;
      for (const axis of axes) {
        const closest = from[axis] + t * (to[axis] - from[axis]);
        const delta = voxel[axis] + 0.5 - closest;
        distanceSquared += delta * delta;
      }
      if (Math.sqrt(distanceSquared) <= radius) inside = true;
    }
    if (inside) painted.add(keyOf(voxel));
  }
  return painted;
}

describe("new volume architecture — brush", () => {
  it("paints the stroke at the source mag and propagates it to every other mag", async () => {
    const { cube, session } = createHarness();
    await materialize(cube, originBuckets(MAGS.length));

    const ctx = editContext({ sourceMagIndex: 0, activeSegmentId: SEGMENT });
    const path: Vector3[] = [
      [10, 16, 5],
      [16, 16, 5],
      [20, 16, 5],
    ];

    session.beginBrushStroke(ctx, path[0], 3, 2);
    session.extendBrushStroke(path[1]);
    session.extendBrushStroke(path[2]);
    const diff = session.endBrushStroke();

    // ── source mag matches an independent, bucket-unaware reference ──
    const expected = referenceStroke(path, 3, 2);
    const actual = new Set(
      paintedVoxels(cube, [0, 0, 0], [32, 32, 32], SEGMENT).map((voxel) => keyOf(voxel)),
    );
    expect(actual).toEqual(expected);
    expect(expected.size).toBeGreaterThan(50); // guard against a vacuous pass

    // ── every coarser mag carries the same region, downsampled ──
    for (let magIndex = 1; magIndex < MAGS.length; magIndex++) {
      const mag = MAGS.get(magIndex);
      for (const key of expected) {
        const voxel = key.split(",").map(Number) as Vector3;
        expect(cube.peek(toMagVoxel(voxel, mag), magIndex)).toBe(SEGMENT);
      }
    }

    // ── one transaction, covering all three mags ──
    expect(session.emitted).toHaveLength(1);
    expect(diff.toolName).toBe("brush");
    expect(diff.sourceMagIndex).toBe(0);
    expect(diff.sequence).toBe(1);
    expect(magIndicesOf(diff.bucketDiffs.map((d) => d.address))).toEqual([0, 1, 2]);
    for (const bucketDiff of diff.bucketDiffs) {
      for (const run of bucketDiff.runs) expect(run.value).toBe(SEGMENT);
    }

    // The mag-0 diff must describe exactly the painted voxels.
    const mag0Runs = diff.bucketDiffs
      .filter((d) => d.address[3] === 0)
      .flatMap((d) => d.runs)
      .reduce((sum, run) => sum + run.length, 0);
    expect(mag0Runs).toBe(expected.size);
  });

  it("coalesces overlapping pointer-moves into one transaction", async () => {
    const { cube, session } = createHarness();
    await materialize(cube, originBuckets(MAGS.length));
    const ctx = editContext();

    // Repeatedly re-paint the same spot; the write set should not grow.
    session.beginBrushStroke(ctx, [16, 16, 5], 2, 2);
    for (let i = 0; i < 20; i++) session.extendBrushStroke([16, 16, 5]);
    const diff = session.endBrushStroke();

    const single = createHarness();
    await materialize(single.cube, originBuckets(MAGS.length));
    single.session.beginBrushStroke(editContext(), [16, 16, 5], 2, 2);
    const singleDiff = single.session.endBrushStroke();

    expect(countDiffVoxels(diff)).toBe(countDiffVoxels(singleDiff));
  });

  it("upsamples to the finest mag when drawing at a coarse mag", async () => {
    const { cube, session } = createHarness();
    await materialize(cube, originBuckets(MAGS.length));

    // Draw a single dab at mag 1 (2-2-1) and check the mag-0 blocks.
    const ctx = editContext({ sourceMagIndex: 1, activeSegmentId: SEGMENT });
    session.beginBrushStroke(ctx, [8, 8, 4], 1.2, 2);
    const diff = session.endBrushStroke();

    const mag1Painted = paintedVoxels(cube, [0, 0, 0], [32, 32, 32], SEGMENT, 1);
    expect(mag1Painted.length).toBeGreaterThan(0);

    // Every mag-1 voxel must have become a full 2×2×1 block at mag 0.
    for (const voxel of mag1Painted) {
      for (let dy = 0; dy < 2; dy++) {
        for (let dx = 0; dx < 2; dx++) {
          expect(cube.peek([voxel[0] * 2 + dx, voxel[1] * 2 + dy, voxel[2]], 0)).toBe(SEGMENT);
        }
      }
    }
    // Exactly 2*2*1 finest-mag voxels per source voxel — no more, no less.
    const mag0Painted = paintedVoxels(cube, [0, 0, 0], [64, 64, 32], SEGMENT, 0);
    expect(mag0Painted.length).toBe(mag1Painted.length * 4);

    // Still one transaction, still covering every mag.
    expect(magIndicesOf(diff.bucketDiffs.map((d) => d.address))).toEqual([0, 1, 2]);
    expect(diff.sourceMagIndex).toBe(1);
  });

  it("records diffs for buckets that were never loaded, without fetching them", async () => {
    const { cube, session, backend } = createHarness();
    // Deliberately materialize nothing.
    const ctx = editContext({ sourceMagIndex: 0, activeSegmentId: SEGMENT });

    session.beginBrushStroke(ctx, [16, 16, 5], 3, 2);
    const diff = session.endBrushStroke();

    expect(backend.fetched).toHaveLength(0);
    expect(cube.fetchCount).toBe(0);
    expect(countDiffVoxels(diff)).toBeGreaterThan(0);
    expect(magIndicesOf(diff.bucketDiffs.map((d) => d.address))).toEqual([0, 1, 2]);

    // Loading afterwards must surface the edit: the journal folds it in.
    const address: BucketAddress = [0, 0, 0, 0];
    await cube.materialize(address);
    expect(cube.peek([16, 16, 5], 0)).toBe(SEGMENT);
  });

  it("honours overwrite-empty-only against resident data", async () => {
    const { cube, session, backend } = createHarness();
    const address: BucketAddress = [0, 0, 0, 0];
    // Pre-existing segment 3 at one voxel the brush will cover.
    backend.seedVoxel(address, [16, 16, 5], 3n);
    await materialize(cube, originBuckets(MAGS.length));
    expect(cube.peek([16, 16, 5], 0)).toBe(3n);

    const ctx = editContext({ overwriteMode: "overwrite-empty-only", activeSegmentId: SEGMENT });
    session.beginBrushStroke(ctx, [16, 16, 5], 3, 2);
    session.endBrushStroke();

    // The occupied voxel survives; its neighbours are painted.
    expect(cube.peek([16, 16, 5], 0)).toBe(3n);
    expect(cube.peek([15, 16, 5], 0)).toBe(SEGMENT);
    expect(cube.peek([17, 16, 5], 0)).toBe(SEGMENT);
  });

  it("undoes an earlier stroke while keeping a later, overlapping one", async () => {
    const { cube, session } = createHarness();
    await materialize(cube, originBuckets(MAGS.length));

    // T1 paints segment 5 over a disk; T2 paints segment 9 over part of it.
    session.beginBrushStroke(editContext({ activeSegmentId: 5n }), [16, 16, 5], 4, 2);
    const t1 = session.endBrushStroke();
    session.beginBrushStroke(editContext({ activeSegmentId: 9n }), [18, 16, 5], 2, 2);
    session.endBrushStroke();

    const onlyT1: Vector3 = [13, 16, 5]; // inside T1's disk, outside T2's
    const overlap: Vector3 = [18, 16, 5]; // painted by both, T2 last
    expect(cube.peek(onlyT1, 0)).toBe(5n);
    expect(cube.peek(overlap, 0)).toBe(9n);

    // Undo T1 specifically. Forward replay means T2 is re-applied on top of a
    // history without T1, so T2's work survives untouched — the property a
    // snapshot restore would destroy.
    session.undoById(t1.id);

    expect(cube.peek(onlyT1, 0)).toBe(0n); // T1's exclusive area reverts
    expect(cube.peek(overlap, 0)).toBe(9n); // T2 survives

    // Coarser mags are folded the same way, not re-derived.
    expect(cube.peek([18 >> 1, 16 >> 1, 5], 1)).toBe(9n);

    session.redoById(t1.id);
    expect(cube.peek(onlyT1, 0)).toBe(5n);
    expect(cube.peek(overlap, 0)).toBe(9n);
  });

  it("round-trips a bucket diff through the binary encoding", async () => {
    const { cube, session } = createHarness();
    await materialize(cube, originBuckets(MAGS.length));
    session.beginBrushStroke(editContext(), [16, 16, 5], 3, 2);
    const diff = session.endBrushStroke();

    for (const bucketDiff of diff.bucketDiffs) {
      const decoded = decodeBucketDiff(encodeBucketDiff(bucketDiff));
      expect(decoded).toEqual(bucketDiff.runs);
    }
  });
});
