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
      /** Constant for the whole stroke — brush size cannot change mid-stroke. */
      radius: number;
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
  seed: Vector3;
  is3D: boolean;
  bounds: BoundingBox | null;
};

export function isDataDependent(intent: EditIntent): intent is DataDependentShape {
  return intent.kind === "floodFill";
}
