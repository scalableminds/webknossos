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

/**
 * Returns a MaskShape (a dense box of selected voxels, see volume_edit_intents.ts)
 * that selects exactly the non-zero voxels of `buffer`. The box is one voxel
 * thick along the third dimension of `plane`.
 */
export function maskShapeFromVoxelBuffer2D(buffer: VoxelBuffer2D, plane: OrthoView): MaskShape {
  // The 3D axes that the buffer's in-plane x and y map to.
  const [u, v] = Dimensions.getIndices(plane);
  const origin: Vector3 = [0, 0, 0];
  buffer.getFast3DCoordinate(buffer.minCoord2d[0], buffer.minCoord2d[1], origin);
  const size: Vector3 = [1, 1, 1];
  size[u] = buffer.width;
  size[v] = buffer.height;

  // Index offset in `selected` for a step of one voxel along each 3D axis.
  const strides: Vector3 = [1, size[0], size[0] * size[1]];
  const selected = new Uint8Array(buffer.width * buffer.height);
  // X and Y refer to the current plane. They correspond to U and V
  // in the global coordinate system.
  for (let x = 0; x < buffer.width; x++) {
    for (let y = 0; y < buffer.height; y++) {
      if (buffer.getValue(x, y) !== 0) selected[x * strides[u] + y * strides[v]] = 1;
    }
  }
  return { kind: "mask", origin, size, selected };
}
