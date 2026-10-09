import { OrthoViews, type Vector3 } from "viewer/constants";
import { maskShapeFromVoxelBuffer2D } from "viewer/model/volumetracing/integration/fill_mask";
import SectionLabeler from "viewer/model/volumetracing/legacy/section_labeling";
import { describe, expect, it } from "vitest";

describe("maskShapeFromVoxelBuffer2D", () => {
  it.each([OrthoViews.PLANE_XY, OrthoViews.PLANE_YZ, OrthoViews.PLANE_XZ] as const)(
    "selects exactly the buffer's voxels in %s",
    (plane) => {
      // Third dimension 7, in a mag where it is 14 in mag 1.
      const labeler = new SectionLabeler("tracingId", plane, 14, [2, 2, 2]);
      const buffer = labeler.createVoxelBuffer2D([5, 9], 4, 3);
      const set: Array<[number, number]> = [
        [0, 0],
        [3, 0],
        [1, 2],
        [3, 2],
      ];
      for (const [a, b] of set) buffer.setValue(a, b, 1);

      const mask = maskShapeFromVoxelBuffer2D(buffer, plane);

      // The voxels the mask selects, in source-mag coordinates.
      const selected: Vector3[] = [];
      const [sx, sy, sz] = mask.size;
      for (let z = 0; z < sz; z++) {
        for (let y = 0; y < sy; y++) {
          for (let x = 0; x < sx; x++) {
            if (mask.selected[x + y * sx + z * sx * sy] !== 0) {
              selected.push([mask.origin[0] + x, mask.origin[1] + y, mask.origin[2] + z]);
            }
          }
        }
      }
      // Where the old path (labelWithVoxelBuffer2D) writes them: through the
      // buffer's own 2D-to-3D mapping.
      const expected = set.map(([a, b]) => {
        const position: Vector3 = [0, 0, 0];
        buffer.getFast3DCoordinate(buffer.minCoord2d[0] + a, buffer.minCoord2d[1] + b, position);
        return position;
      });
      const sortKey = (p: Vector3) => p.join(",");
      expect(selected.map(sortKey).sort()).toEqual(expected.map(sortKey).sort());
      expect(mask.selected.length).toBe(sx * sy * sz);
      expect(mask.size.filter((extent) => extent === 1).length).toBeGreaterThanOrEqual(1);
    },
  );
});
