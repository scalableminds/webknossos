import type { BoundingBox, Vector3 } from "./types";

/**
 * Two families, split by *how the intent becomes voxels* — synchronously from a
 * region we already know, or asynchronously by reading data to discover one.
 */
export type EditIntent = RasterizableShape | DataDependentShape;

/** Region already known; the Rasterizer converts it synchronously. */
export type RasterizableShape = AnalyticShape | MaskShape;

/** Fully determined by geometry — no voxel reads needed to know the region. */
export type AnalyticShape =
  | {
      kind: "brush";
      /** Pointer path in source-mag voxel coordinates (floats). */
      path: Vector3[];
      /**
       * Per-axis radius in source-mag voxels, constant for the whole stroke.
       *
       * Per-axis rather than scalar because the brush is a sphere in *physical*
       * space, and a voxel is generally not a cube. With a voxel size of
       * 11×11×28 nm, a 100 nm radius is ~9 voxels in x and y but only ~3.5 in
       * z, so a scalar radius would paint an ellipse in every viewport except
       * the one whose two in-plane axes happen to be equally scaled.
       *
       * The mag factor is folded in here too, so the rasterizer needs no
       * knowledge of either voxel size or mag.
       */
      radius: Vector3;
      /** null => 3D sphere brush; otherwise paint one slice along this axis. */
      planeAxis: 0 | 1 | 2 | null;
    }
  | { kind: "box"; min: Vector3; max: Vector3 };

/**
 * An explicit dense region over an axis-aligned box, in source-mag voxel space.
 * Emitted directly by ML and quick-select tools, whose models naturally produce
 * a small dense patch and which should not have to know about buckets.
 *
 * `selected` holds one byte per voxel (0 = outside, non-zero = inside), indexed
 * `x + y * size[0] + z * size[0] * size[1]`, x fastest. One byte rather than one
 * bit because this is an interchange format: byte arrays impose no alignment
 * constraint on the producer and have unambiguous byte order across worker and
 * WASM boundaries. Packing it is a later optimization.
 */
export interface MaskShape {
  kind: "mask";
  origin: Vector3;
  size: Vector3;
  selected: Uint8Array;
}

/**
 * Region discovered by reading the data, across buckets that may not be loaded.
 * Handled by the ShapeResolver, not the Rasterizer.
 */
export type DataDependentShape = {
  kind: "floodFill";
  /**
   * An integer voxel coordinate in source-mag space. Unlike AnalyticShape
   * coordinates (which are continuous, for geometric precision), this is used
   * for direct array indexing, so a caller converting from a coarser mag must
   * floor the result rather than pass it through unrounded — a mag1 position
   * only divides evenly by the mag factor when it happens to be mag-aligned.
   */
  seed: Vector3;
  is3D: boolean;
  bounds: BoundingBox | null;
};

export function isDataDependent(intent: EditIntent): intent is DataDependentShape {
  return intent.kind === "floodFill";
}
