/**
 * Converts the section labeler's auto-fill (a one-voxel-thick 2D slice in the
 * labeled mag, see legacy/section_labeling.ts) into a MaskShape the core can
 * rasterize, so that the brush can fill within its own transaction.
 */

import type { OrthoView } from "viewer/constants";
import Dimensions from "viewer/model/dimensions";
import type { VoxelBuffer2D } from "viewer/model/volumetracing/legacy/section_labeling";
import type { Vector3 } from "../core/volume_annotation_types";
import type { MaskShape } from "../core/volume_edit_intents";

export function maskShapeFromVoxelBuffer2D(buffer: VoxelBuffer2D, plane: OrthoView): MaskShape {
  const [u, v] = Dimensions.getIndices(plane);
  const origin: Vector3 = [0, 0, 0];
  buffer.getFast3DCoordinate(buffer.minCoord2d[0], buffer.minCoord2d[1], origin);
  const size: Vector3 = [1, 1, 1];
  size[u] = buffer.width;
  size[v] = buffer.height;

  // MaskShape.selected is x-fastest over `size`; the buffer is indexed a * height + b.
  const strides: Vector3 = [1, size[0], size[0] * size[1]];
  const selected = new Uint8Array(buffer.width * buffer.height);
  for (let a = 0; a < buffer.width; a++) {
    for (let b = 0; b < buffer.height; b++) {
      if (buffer.getValue(a, b) !== 0) selected[a * strides[u] + b * strides[v]] = 1;
    }
  }
  return { kind: "mask", origin, size, selected };
}
