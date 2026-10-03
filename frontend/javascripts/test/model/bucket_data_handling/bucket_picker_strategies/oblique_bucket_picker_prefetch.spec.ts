import { M4x4, type Matrix4x4 } from "libs/mjs";
import type { Vector3, Vector4 } from "viewer/constants";
import { UnitLong } from "viewer/constants";
import { _getDummyFlycamMatrix } from "viewer/model/accessors/flycam_accessor";
import determineBucketsForPlane from "viewer/model/bucket_data_handling/bucket_picker_strategies/oblique_bucket_picker_rows";
import type { PlaneRects } from "viewer/store";
import { describe, expect, it } from "vitest";

// z is not downsampled, so buckets stay thin along z while zooming out. This is where a fixed
// prefetch distance in local units used to reach past the adjacent bucket layer.
const MAGS: Vector3[] = [
  [1, 1, 1],
  [2, 2, 1],
  [4, 4, 1],
  [8, 8, 1],
];
const LOG_ZOOM_STEP = 3;
const BUCKET_THICKNESS_Z = 32;
const CAMERA_LAYER = 10;
// 0.2 bucket thicknesses below the boundary to the next layer, i.e. within the prefetch distance.
const POSITION: Vector3 = [1000, 1000, BUCKET_THICKNESS_Z * (CAMERA_LAYER + 0.8)];

function getMatrix(zoom: number): Matrix4x4 {
  const matrix = [
    ..._getDummyFlycamMatrix({ factor: [11, 11, 24], unit: UnitLong.nm }),
  ] as Matrix4x4;
  matrix[12] = POSITION[0];
  matrix[13] = POSITION[1];
  matrix[14] = POSITION[2];
  return M4x4.scale1(zoom, matrix);
}

describe("Oblique bucket picker prefetching along the view axis", () => {
  // Only the XY viewport has a size, so all picked z layers stem from the XY plane.
  const emptyRect = { width: 0, height: 0, top: 0, left: 0 };
  const rects: PlaneRects = {
    PLANE_XY: { width: 384, height: 384, top: 0, left: 0 },
    PLANE_XZ: emptyRect,
    PLANE_YZ: emptyRect,
    TDView: emptyRect,
  };

  for (const zoom of [1, 4, 16]) {
    it(`picks only the adjacent bucket layer (zoom ${zoom})`, () => {
      const addresses: Vector4[] = [];
      determineBucketsForPlane(
        "BEST_QUALITY_FIRST",
        MAGS,
        POSITION,
        (address) => addresses.push(address),
        getMatrix(zoom),
        LOG_ZOOM_STEP,
        rects,
      );
      const zLayers = [...new Set(addresses.map((address) => address[2]))].sort((a, b) => a - b);
      expect(zLayers).toEqual([CAMERA_LAYER, CAMERA_LAYER + 1]);
    });
  }
});
