import { M4x4, type Matrix4x4 } from "libs/mjs";
import type { Vector3, Vector4 } from "viewer/constants";
import { UnitLong } from "viewer/constants";
import { _getDummyFlycamMatrix } from "viewer/model/accessors/flycam_accessor";
import determineBucketsForPlaneWithScanLines from "viewer/model/bucket_data_handling/bucket_picker_strategies/oblique_bucket_picker";
import determineBucketsForPlaneWithFloodFill from "viewer/model/bucket_data_handling/bucket_picker_strategies/oblique_bucket_picker_flood_fill";
import type { PlaneRects } from "viewer/store";
import { describe, expect, it } from "vitest";

const STRATEGIES = {
  scanLines: determineBucketsForPlaneWithScanLines,
  floodFill: determineBucketsForPlaneWithFloodFill,
};

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

function pick(
  strategy: keyof typeof STRATEGIES,
  matrix: Matrix4x4,
  rects: PlaneRects,
  position: Vector3,
  denseMags: Vector3[],
  logZoomStep: number,
): Vector4[] {
  const addresses: Vector4[] = [];
  STRATEGIES[strategy](
    "BEST_QUALITY_FIRST",
    denseMags,
    position,
    (address) => addresses.push(address),
    matrix,
    logZoomStep,
    rects,
    undefined,
    undefined,
    true,
  );
  return addresses;
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

  for (const strategy of Object.keys(STRATEGIES) as Array<keyof typeof STRATEGIES>) {
    for (const zoom of [1, 4, 16]) {
      it(`${strategy} picks only the adjacent bucket layer (zoom ${zoom})`, () => {
        const addresses = pick(strategy, getMatrix(zoom), rects, POSITION, MAGS, LOG_ZOOM_STEP);
        const zLayers = [...new Set(addresses.map((address) => address[2]))].sort((a, b) => a - b);
        expect(zLayers).toEqual([CAMERA_LAYER, CAMERA_LAYER + 1]);
      });
    }
  }

  it("scan lines only pick buckets that the flood fill picks, too (rotated plane)", () => {
    const rect = { width: 384, height: 384, top: 0, left: 0 };
    const fullRects: PlaneRects = { PLANE_XY: rect, PLANE_XZ: rect, PLANE_YZ: rect, TDView: rect };
    let matrix = M4x4.rotate(Math.PI / 6, [1, 0, 0], M4x4.identity(), []);
    matrix = M4x4.rotate(Math.PI / 9, [0, 1, 0], matrix, []);
    matrix = M4x4.rotate(Math.PI / 18, [0, 0, 1], matrix, []);
    const position: Vector3 = [1223, 3218, 518];
    matrix[12] = position[0];
    matrix[13] = position[1];
    matrix[14] = position[2];
    const isotropicMags: Vector3[] = [
      [1, 1, 1],
      [2, 2, 2],
      [4, 4, 4],
    ];

    const toKey = (address: Vector4) => address.join(",");
    const floodFillKeys = new Set(
      pick("floodFill", matrix, fullRects, position, isotropicMags, 0).map(toKey),
    );
    const missingInFloodFill = pick("scanLines", matrix, fullRects, position, isotropicMags, 0)
      .map(toKey)
      .filter((key) => !floodFillKeys.has(key));
    expect(missingInFloodFill).toEqual([]);
  });
});
