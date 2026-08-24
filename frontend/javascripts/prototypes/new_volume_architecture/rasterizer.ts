import type { MaskShape, RasterizableShape } from "./intents";
import type { BucketWriter, VolumeTransaction } from "./transaction";
import {
  type BoundingBox,
  BUCKET_WIDTH,
  type BucketAddress,
  type EditContext,
  floorDiv,
  isInBoundingBox,
  type Vector3,
  voxelIndexOf,
} from "./types";

/**
 * The single place that turns geometry into voxel indices.
 *
 * Runs exactly once per transaction, at the source mag. Every other mag is
 * derived by mag propagation, never by re-rasterizing at another resolution:
 * two independent rasterizations of the same circle disagree at the boundary,
 * which no downsampling rule could repair.
 *
 * Synchronous and free of I/O by construction — data-dependent shapes are
 * resolved elsewhere (see resolver.ts) before reaching this point.
 */
export function rasterize(shape: RasterizableShape, ctx: EditContext, tx: VolumeTransaction): void {
  switch (shape.kind) {
    case "brush":
      rasterizeBrush(shape, ctx, tx);
      return;
    case "box":
      rasterizeBox(shape.min, shape.max, ctx, tx);
      return;
    case "mask":
      rasterizeMask(shape, ctx, tx);
      return;
  }
}

function rasterizeBrush(
  shape: Extract<RasterizableShape, { kind: "brush" }>,
  ctx: EditContext,
  tx: VolumeTransaction,
): void {
  if (shape.path.length === 0) return;
  // A single click still paints a dab: treat it as a zero-length segment.
  const segments: Array<[Vector3, Vector3]> =
    shape.path.length === 1
      ? [[shape.path[0], shape.path[0]]]
      : shape.path.slice(0, -1).map((from, i) => [from, shape.path[i + 1]]);

  for (const [from, to] of segments) {
    rasterizeCapsule(from, to, shape.radius, shape.planeAxis, ctx, tx);
  }
}

/** Everything within `radius` of the segment from → to, at the source mag. */
function rasterizeCapsule(
  from: Vector3,
  to: Vector3,
  radius: number,
  planeAxis: 0 | 1 | 2 | null,
  ctx: EditContext,
  tx: VolumeTransaction,
): void {
  const box = clipBox(capsuleBoundingBox(from, to, radius, planeAxis), ctx.editableBoundingBox);
  if (box == null) return;

  forEachBucketRow(box, ctx, (address, rowY, rowZ, xStart, xEnd) => {
    const writer = tx.writerFor(address, ctx.activeSegmentId);
    const rowBase = rowBaseIndex(address, rowY, rowZ);
    emitSpansAlongRow(
      writer,
      rowBase,
      address,
      xStart,
      xEnd,
      ctx,
      (x) => distanceToSegment([x + 0.5, rowY + 0.5, rowZ + 0.5], from, to, planeAxis) <= radius,
    );
  });
}

function rasterizeBox(min: Vector3, max: Vector3, ctx: EditContext, tx: VolumeTransaction): void {
  const box = clipBox({ min, max }, ctx.editableBoundingBox);
  if (box == null) return;
  forEachBucketRow(box, ctx, (address, rowY, rowZ, xStart, xEnd) => {
    const writer = tx.writerFor(address, ctx.activeSegmentId);
    const rowBase = rowBaseIndex(address, rowY, rowZ);
    emitSpansAlongRow(writer, rowBase, address, xStart, xEnd, ctx, () => true);
  });
}

function rasterizeMask(shape: MaskShape, ctx: EditContext, tx: VolumeTransaction): void {
  const [sx, sy, sz] = shape.size;
  const expected = sx * sy * sz;
  if (shape.selected.length !== expected) {
    throw new Error(`MaskShape.selected has ${shape.selected.length} bytes, expected ${expected}`);
  }
  const box = clipBox(
    { min: shape.origin, max: [shape.origin[0] + sx, shape.origin[1] + sy, shape.origin[2] + sz] },
    ctx.editableBoundingBox,
  );
  if (box == null) return;

  forEachBucketRow(box, ctx, (address, rowY, rowZ, xStart, xEnd) => {
    const writer = tx.writerFor(address, ctx.activeSegmentId);
    const rowBase = rowBaseIndex(address, rowY, rowZ);
    const localY = rowY - shape.origin[1];
    const localZ = rowZ - shape.origin[2];
    emitSpansAlongRow(writer, rowBase, address, xStart, xEnd, ctx, (x) => {
      const localX = x - shape.origin[0];
      return shape.selected[localX + localY * sx + localZ * sx * sy] !== 0;
    });
  });
}

/**
 * Walk the box bucket by bucket, then row by row within each bucket. Bucket
 * address and writer are resolved once per bucket; the inner loop touches
 * nothing but integers.
 */
function forEachBucketRow(
  box: BoundingBox,
  ctx: EditContext,
  visit: (address: BucketAddress, rowY: number, rowZ: number, xStart: number, xEnd: number) => void,
): void {
  const bucketMin: Vector3 = [
    floorDiv(box.min[0], BUCKET_WIDTH),
    floorDiv(box.min[1], BUCKET_WIDTH),
    floorDiv(box.min[2], BUCKET_WIDTH),
  ];
  const bucketMax: Vector3 = [
    floorDiv(box.max[0] - 1, BUCKET_WIDTH),
    floorDiv(box.max[1] - 1, BUCKET_WIDTH),
    floorDiv(box.max[2] - 1, BUCKET_WIDTH),
  ];

  for (let bz = bucketMin[2]; bz <= bucketMax[2]; bz++) {
    for (let by = bucketMin[1]; by <= bucketMax[1]; by++) {
      for (let bx = bucketMin[0]; bx <= bucketMax[0]; bx++) {
        const address: BucketAddress = [bx, by, bz, ctx.sourceMagIndex];
        const zStart = Math.max(box.min[2], bz * BUCKET_WIDTH);
        const zEnd = Math.min(box.max[2], (bz + 1) * BUCKET_WIDTH);
        const yStart = Math.max(box.min[1], by * BUCKET_WIDTH);
        const yEnd = Math.min(box.max[1], (by + 1) * BUCKET_WIDTH);
        const xStart = Math.max(box.min[0], bx * BUCKET_WIDTH);
        const xEnd = Math.min(box.max[0], (bx + 1) * BUCKET_WIDTH);
        if (xStart >= xEnd) continue;
        for (let z = zStart; z < zEnd; z++) {
          for (let y = yStart; y < yEnd; y++) {
            visit(address, y, z, xStart, xEnd);
          }
        }
      }
    }
  }
}

/** Flat index of x=0 in the row (rowY, rowZ) of the given bucket. */
function rowBaseIndex(address: BucketAddress, rowY: number, rowZ: number): number {
  const localY = rowY - address[1] * BUCKET_WIDTH;
  const localZ = rowZ - address[2] * BUCKET_WIDTH;
  return voxelIndexOf(0, localY, localZ);
}

/**
 * Walk one row, accumulating contiguous accepted voxels and emitting them as
 * runs. This is where the overwrite predicate is applied: it splits a span into
 * sub-spans rather than being consulted per emitted voxel.
 */
function emitSpansAlongRow(
  writer: BucketWriter,
  rowBase: number,
  address: BucketAddress,
  xStart: number,
  xEnd: number,
  ctx: EditContext,
  contains: (x: number) => boolean,
): void {
  // overwrite-all needs no reads at all. For absent and pending buckets there
  // is no authoritative content to test against, so paint optimistically:
  // overwrite mode protects what is visible, and those buckets render as
  // background.
  const isBackground = ctx.overwriteMode === "overwrite-empty-only" ? writer.isBackground : null;
  const bucketOriginX = address[0] * BUCKET_WIDTH;

  let runStart = -1;
  for (let x = xStart; x < xEnd; x++) {
    const localX = x - bucketOriginX;
    const index = rowBase + localX;
    const accepted = contains(x) && (isBackground == null || isBackground(index));
    if (accepted) {
      if (runStart < 0) runStart = index;
    } else if (runStart >= 0) {
      writer.markRun(runStart, index - runStart);
      runStart = -1;
    }
  }
  if (runStart >= 0) {
    writer.markRun(runStart, rowBase + (xEnd - bucketOriginX) - runStart);
  }
}

function capsuleBoundingBox(
  from: Vector3,
  to: Vector3,
  radius: number,
  planeAxis: 0 | 1 | 2 | null,
): BoundingBox {
  const min: Vector3 = [0, 0, 0];
  const max: Vector3 = [0, 0, 0];
  for (let axis = 0; axis < 3; axis++) {
    if (planeAxis === axis) {
      // 2D brush: exactly one slice thick, at the path's own coordinate.
      const slice = Math.floor(from[axis]);
      min[axis] = slice;
      max[axis] = slice + 1;
    } else {
      min[axis] = Math.floor(Math.min(from[axis], to[axis]) - radius);
      max[axis] = Math.ceil(Math.max(from[axis], to[axis]) + radius) + 1;
    }
  }
  return { min, max };
}

function clipBox(box: BoundingBox, clip: BoundingBox | null): BoundingBox | null {
  if (clip == null) {
    return box.min.every((value, axis) => value < box.max[axis]) ? box : null;
  }
  const min: Vector3 = [0, 0, 0];
  const max: Vector3 = [0, 0, 0];
  for (let axis = 0; axis < 3; axis++) {
    min[axis] = Math.max(box.min[axis], clip.min[axis]);
    max[axis] = Math.min(box.max[axis], clip.max[axis]);
    if (min[axis] >= max[axis]) return null;
  }
  return { min, max };
}

/** Distance from a point to a segment, ignoring the plane axis for 2D brushes. */
function distanceToSegment(
  point: Vector3,
  from: Vector3,
  to: Vector3,
  planeAxis: 0 | 1 | 2 | null,
): number {
  let dot = 0;
  let lengthSquared = 0;
  for (let axis = 0; axis < 3; axis++) {
    if (axis === planeAxis) continue;
    const d = to[axis] - from[axis];
    dot += (point[axis] - from[axis]) * d;
    lengthSquared += d * d;
  }
  const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, dot / lengthSquared));

  let distanceSquared = 0;
  for (let axis = 0; axis < 3; axis++) {
    if (axis === planeAxis) continue;
    const closest = from[axis] + t * (to[axis] - from[axis]);
    const delta = point[axis] - closest;
    distanceSquared += delta * delta;
  }
  return Math.sqrt(distanceSquared);
}

export { isInBoundingBox };
