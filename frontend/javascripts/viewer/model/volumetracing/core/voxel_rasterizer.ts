import {
  type BoundingBox,
  BUCKET_WIDTH,
  type BucketAddress,
  type EditContext,
  floorDiv,
  isInBoundingBox,
  type Vector3,
  voxelIndexOf,
} from "./volume_annotation_types";
import type { AffineMap, MaskShape, RasterizableShape } from "./volume_edit_intents";
import type { BucketWriter, VolumeTransaction } from "./volume_transaction";

/**
 * The single place that turns geometry into voxel indices.
 *
 * Runs exactly once per transaction, at the source mag. Every other mag is
 * derived by mag propagation, never by re-rasterizing at another resolution:
 * two independent rasterizations of the same circle disagree at the boundary,
 * which no downsampling rule could repair.
 *
 * Synchronous and free of I/O by construction — data-dependent shapes are
 * resolved elsewhere (see flood_fill_resolver.ts) before reaching this point.
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

  const { voxelToShapeSpace } = shape;
  if (voxelToShapeSpace != null) {
    const shapeToVoxel = invertAffineMap(voxelToShapeSpace);
    for (const [from, to] of segments) {
      rasterizeTransformedCapsule(
        from,
        to,
        shape.radius,
        shape.planeAxis,
        voxelToShapeSpace,
        shapeToVoxel,
        ctx,
        tx,
      );
    }
    return;
  }

  for (const [from, to] of segments) {
    rasterizeCapsule(from, to, shape.radius, shape.planeAxis, ctx, tx);
  }
}

/**
 * Everything within the per-axis `radius` of the segment from → to.
 *
 * "Capsule" is the shape that sweeping the round brush along that segment
 * traces out: a cylinder with a half-sphere cap at each end (for a 2D brush,
 * a rectangle with a half-disc at each end). A single click degenerates to
 * just the sphere/disc, since `from` and `to` coincide.
 */
function rasterizeCapsule(
  from: Vector3,
  to: Vector3,
  radius: Vector3,
  planeAxis: 0 | 1 | 2 | null,
  ctx: EditContext,
  tx: VolumeTransaction,
): void {
  const box = clipBox(
    capsuleBoundingBox(from, to, radius, planeAxis),
    tx.getEditableBoundingBox(ctx.sourceMagIndex),
  );
  if (box == null) return;

  forEachBucketRow(box, ctx, tx, (writer, address, rowY, rowZ, xStart, xEnd) => {
    const rowBase = rowBaseIndex(address, rowY, rowZ);
    emitSpansAlongRow(writer, rowBase, address, xStart, xEnd, ctx, (x) =>
      isInsideCapsule([x + 0.5, rowY + 0.5, rowZ + 0.5], from, to, radius, planeAxis),
    );
  });
}

/**
 * Like rasterizeCapsule, but `from`, `to`, `radius` and `planeAxis` are given in
 * the space that `voxelToShapeSpace` maps the source-mag voxels into.
 *
 * Each voxel center is mapped into that space and tested against the capsule
 * there. For a 2D brush, the painted slice is the plane through `from`
 * perpendicular to `planeAxis`, and a voxel is painted if it intersects that
 * plane: the distance of its center to the plane is at most half the voxel's
 * extent along the plane normal. Without a rotation, this is exactly one slice
 * of voxels, as in rasterizeCapsule. With an oblique rotation, the voxels the
 * plane cuts through form a staircase that can be more than one voxel thick.
 */
function rasterizeTransformedCapsule(
  from: Vector3,
  to: Vector3,
  radius: Vector3,
  planeAxis: 0 | 1 | 2 | null,
  voxelToShapeSpace: AffineMap,
  shapeToVoxel: AffineMap,
  ctx: EditContext,
  tx: VolumeTransaction,
): void {
  const { linear } = voxelToShapeSpace;
  const halfThickness =
    planeAxis == null
      ? 0
      : 0.5 *
        (Math.abs(linear[planeAxis * 3]) +
          Math.abs(linear[planeAxis * 3 + 1]) +
          Math.abs(linear[planeAxis * 3 + 2]));

  // Bounding box in shape space, mapped to voxel space via its eight corners.
  const shapeMin: Vector3 = [0, 0, 0];
  const shapeMax: Vector3 = [0, 0, 0];
  for (let axis = 0; axis < 3; axis++) {
    if (axis === planeAxis) {
      shapeMin[axis] = from[axis] - halfThickness;
      shapeMax[axis] = from[axis] + halfThickness;
    } else {
      shapeMin[axis] = Math.min(from[axis], to[axis]) - radius[axis];
      shapeMax[axis] = Math.max(from[axis], to[axis]) + radius[axis];
    }
  }
  const min: Vector3 = [Infinity, Infinity, Infinity];
  const max: Vector3 = [-Infinity, -Infinity, -Infinity];
  for (let corner = 0; corner < 8; corner++) {
    const voxel = applyAffineMap(shapeToVoxel, [
      corner & 1 ? shapeMax[0] : shapeMin[0],
      corner & 2 ? shapeMax[1] : shapeMin[1],
      corner & 4 ? shapeMax[2] : shapeMin[2],
    ]);
    for (let axis = 0; axis < 3; axis++) {
      min[axis] = Math.min(min[axis], Math.floor(voxel[axis]));
      max[axis] = Math.max(max[axis], Math.ceil(voxel[axis]) + 1);
    }
  }
  const box = clipBox({ min, max }, tx.getEditableBoundingBox(ctx.sourceMagIndex));
  if (box == null) return;

  // Stepping one voxel along x moves the mapped point by the first column.
  const step: Vector3 = [linear[0], linear[3], linear[6]];
  const point: Vector3 = [0, 0, 0];
  forEachBucketRow(box, ctx, tx, (writer, address, rowY, rowZ, xStart, xEnd) => {
    const rowBase = rowBaseIndex(address, rowY, rowZ);
    const rowStart = applyAffineMap(voxelToShapeSpace, [0.5, rowY + 0.5, rowZ + 0.5]);
    emitSpansAlongRow(writer, rowBase, address, xStart, xEnd, ctx, (x) => {
      point[0] = rowStart[0] + x * step[0];
      point[1] = rowStart[1] + x * step[1];
      point[2] = rowStart[2] + x * step[2];
      if (planeAxis != null) {
        // Half-open, so that a voxel that only touches the plane with a face
        // is painted on one side of it only. The epsilon keeps that decision
        // stable against rounding errors of the transform.
        const distanceToPlane = point[planeAxis] - from[planeAxis];
        if (
          distanceToPlane <= -halfThickness + PLANE_EPSILON ||
          distanceToPlane > halfThickness + PLANE_EPSILON
        ) {
          return false;
        }
      }
      return isInsideCapsule(point, from, to, radius, planeAxis);
    });
  });
}

const PLANE_EPSILON = 1e-6;

function applyAffineMap(map: AffineMap, point: Vector3): Vector3 {
  const { linear, offset } = map;
  return [
    linear[0] * point[0] + linear[1] * point[1] + linear[2] * point[2] + offset[0],
    linear[3] * point[0] + linear[4] * point[1] + linear[5] * point[2] + offset[1],
    linear[6] * point[0] + linear[7] * point[1] + linear[8] * point[2] + offset[2],
  ];
}

function invertAffineMap(map: AffineMap): AffineMap {
  const [a, b, c, d, e, f, g, h, i] = map.linear;
  const determinant = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  if (determinant === 0) {
    throw new Error("The brush transform is not invertible.");
  }
  const linear = [
    (e * i - f * h) / determinant,
    (c * h - b * i) / determinant,
    (b * f - c * e) / determinant,
    (f * g - d * i) / determinant,
    (a * i - c * g) / determinant,
    (c * d - a * f) / determinant,
    (d * h - e * g) / determinant,
    (b * g - a * h) / determinant,
    (a * e - b * d) / determinant,
  ] as const;
  const inverseWithoutOffset: AffineMap = { linear, offset: [0, 0, 0] };
  const [x, y, z] = applyAffineMap(inverseWithoutOffset, map.offset);
  return { linear, offset: [-x, -y, -z] };
}

function rasterizeBox(min: Vector3, max: Vector3, ctx: EditContext, tx: VolumeTransaction): void {
  const box = clipBox({ min, max }, tx.getEditableBoundingBox(ctx.sourceMagIndex));
  if (box == null) return;
  forEachBucketRow(box, ctx, tx, (writer, address, rowY, rowZ, xStart, xEnd) => {
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
    tx.getEditableBoundingBox(ctx.sourceMagIndex),
  );
  if (box == null) return;

  forEachBucketRow(box, ctx, tx, (writer, address, rowY, rowZ, xStart, xEnd) => {
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
 * address and writer are resolved once per bucket. The inner loop touches
 * nothing but integers.
 */
function forEachBucketRow(
  box: BoundingBox,
  ctx: EditContext,
  tx: VolumeTransaction,
  visit: (
    writer: BucketWriter,
    address: BucketAddress,
    rowY: number,
    rowZ: number,
    xStart: number,
    xEnd: number,
  ) => void,
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
        const address: BucketAddress = [bx, by, bz, ctx.sourceMagIndex, ctx.additionalCoordinates];
        const zStart = Math.max(box.min[2], bz * BUCKET_WIDTH);
        const zEnd = Math.min(box.max[2], (bz + 1) * BUCKET_WIDTH);
        const yStart = Math.max(box.min[1], by * BUCKET_WIDTH);
        const yEnd = Math.min(box.max[1], (by + 1) * BUCKET_WIDTH);
        const xStart = Math.max(box.min[0], bx * BUCKET_WIDTH);
        const xEnd = Math.min(box.max[0], (bx + 1) * BUCKET_WIDTH);
        // Bail before resolving a writer: a bucket this box doesn't actually
        // reach must not get an empty entry in the transaction's write set
        // (spurious startDataMutation/GPU-refresh on flush for no real edit).
        if (xStart >= xEnd) continue;

        const writer = tx.writerFor(address, ctx.activeSegmentId);
        for (let z = zStart; z < zEnd; z++) {
          for (let y = yStart; y < yEnd; y++) {
            visit(writer, address, y, z, xStart, xEnd);
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
  // is no authoritative content to test against, so write optimistically:
  // overwrite mode protects what is visible, and those buckets render as
  // background. The same goes for every mag other than this one — mag
  // propagation never consults the filter, since that would mean a data loading dependency.
  const isOverwritable =
    ctx.overwriteMode === "overwrite-empty-only" ? writer.isOverwritable : null;
  const bucketOriginX = address[0] * BUCKET_WIDTH;

  let runStart = -1;
  for (let x = xStart; x < xEnd; x++) {
    const localX = x - bucketOriginX;
    const index = rowBase + localX;
    const accepted = contains(x) && (isOverwritable == null || isOverwritable(index));
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

/**
 * Axis-aligned bounding box of the capsule swept from `from` to `to` with
 * per-axis `radius` (§4: physical, not voxel, roundness). Along `planeAxis`
 * the box collapses to the single slice at `from`'s coordinate, since a 2D
 * brush paints only that slice regardless of how far `to` moved along it.
 * Integer voxel bounds, min inclusive / max exclusive.
 */
function capsuleBoundingBox(
  from: Vector3,
  to: Vector3,
  radius: Vector3,
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
      min[axis] = Math.floor(Math.min(from[axis], to[axis]) - radius[axis]);
      max[axis] = Math.ceil(Math.max(from[axis], to[axis]) + radius[axis]) + 1;
    }
  }
  return { min, max };
}

function clipBox(box: BoundingBox, clip: BoundingBox): BoundingBox | null {
  const min: Vector3 = [0, 0, 0];
  const max: Vector3 = [0, 0, 0];
  for (let axis = 0; axis < 3; axis++) {
    min[axis] = Math.max(box.min[axis], clip.min[axis]);
    max[axis] = Math.min(box.max[axis], clip.max[axis]);
    if (min[axis] >= max[axis]) return null;
  }
  return { min, max };
}

/**
 * Whether a point lies within the capsule swept from `from` to `to`.
 *
 * Coordinates are divided by the per-axis radius first, which turns the
 * anisotropic capsule into a unit-radius one — equivalent to testing a sphere
 * in physical space rather than an ellipsoid in voxel space. The plane axis is
 * dropped entirely for 2D brushes, which paint a single slice.
 * Points exactly on the border are outside. Otherwise, a brush centered on a voxel
 * would get single-voxel "poles" at its four extreme points.
 */
function isInsideCapsule(
  point: Vector3,
  from: Vector3,
  to: Vector3,
  radius: Vector3,
  planeAxis: 0 | 1 | 2 | null,
): boolean {
  let dot = 0;
  let lengthSquared = 0;
  for (let axis = 0; axis < 3; axis++) {
    if (axis === planeAxis) continue;
    const d = (to[axis] - from[axis]) / radius[axis];
    dot += ((point[axis] - from[axis]) / radius[axis]) * d;
    lengthSquared += d * d;
  }
  const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, dot / lengthSquared));

  let distanceSquared = 0;
  for (let axis = 0; axis < 3; axis++) {
    if (axis === planeAxis) continue;
    const closest = from[axis] + t * (to[axis] - from[axis]);
    const delta = (point[axis] - closest) / radius[axis];
    distanceSquared += delta * delta;
  }
  return distanceSquared < 1;
}

export { isInBoundingBox };
