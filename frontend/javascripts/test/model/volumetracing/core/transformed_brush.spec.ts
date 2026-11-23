import type { AffineMap, SegmentId, Vector3 } from "viewer/model/volumetracing/core";
import { describe, expect, it } from "vitest";
import {
  createHarness,
  editContext,
  keyOf,
  MAGS,
  materialize,
  originBuckets,
  paintedVoxels,
} from "./volume_test_harness";

const SEGMENT: SegmentId = 7n;
const BOX_MAX: Vector3 = [32, 32, 32];

type Stroke = {
  path: Vector3[];
  radius: Vector3;
  planeAxis: 0 | 1 | 2;
  voxelToShapeSpace?: AffineMap;
};

async function paint(stroke: Stroke, sourceMagIndex = 0): Promise<Set<string>> {
  const { cube, session } = createHarness();
  await materialize(cube, originBuckets(MAGS.length));
  const ctx = editContext({ sourceMagIndex, activeSegmentId: SEGMENT });
  session.beginBrushStroke(
    ctx,
    stroke.path[0],
    stroke.radius,
    stroke.planeAxis,
    stroke.voxelToShapeSpace,
  );
  for (const point of stroke.path.slice(1)) {
    session.extendBrushStroke(point);
  }
  session.endBrushStroke();
  return new Set(
    paintedVoxels(cube, [0, 0, 0], BOX_MAX, SEGMENT, sourceMagIndex).map((voxel) => keyOf(voxel)),
  );
}

function apply(map: AffineMap, point: Vector3): Vector3 {
  const { linear: l, offset: o } = map;
  return [
    l[0] * point[0] + l[1] * point[1] + l[2] * point[2] + o[0],
    l[3] * point[0] + l[4] * point[1] + l[5] * point[2] + o[1],
    l[6] * point[0] + l[7] * point[1] + l[8] * point[2] + o[2],
  ];
}

function rotationAroundX(degrees: number, offset: Vector3): AffineMap {
  const radians = (degrees * Math.PI) / 180;
  const [cos, sin] = [Math.cos(radians), Math.sin(radians)];
  return { linear: [1, 0, 0, 0, cos, -sin, 0, sin, cos], offset };
}

describe("volume annotation core — transformed brush", () => {
  it("paints the same voxels as the untransformed brush for a scaling by the mag", async () => {
    // Source mag 1 is 2-2-1. The transformed brush is given in mag-1 voxels.
    const mag: Vector3 = [2, 2, 1];
    const toMag1: AffineMap = { linear: [2, 0, 0, 0, 2, 0, 0, 0, 1], offset: [0, 0, 0] };
    const pathInMag: Vector3[] = [
      [6.5, 8.5, 5.5],
      [9, 12, 5.5],
      [12.5, 11.5, 5.5],
    ];
    const radiusInMag: Vector3 = [3, 2.5, 4];

    for (const planeAxis of [0, 1, 2] as const) {
      const expected = await paint({ path: pathInMag, radius: radiusInMag, planeAxis }, 1);
      const actual = await paint(
        {
          path: pathInMag.map((point) => point.map((v, axis) => v * mag[axis]) as Vector3),
          radius: radiusInMag.map((v, axis) => v * mag[axis]) as Vector3,
          planeAxis,
          voxelToShapeSpace: toMag1,
        },
        1,
      );
      expect(actual).toEqual(expected);
      expect(expected.size).toBeGreaterThan(10);
    }
  });

  it("paints the permuted voxels for a rotation by 90°", async () => {
    // Rendered (x, y, z) = (x, 30 - z, y) for layer (x, y, z): the rendered XY plane
    // is a layer XZ plane, and the rendered y axis runs along the layer z axis.
    const voxelToShapeSpace: AffineMap = {
      linear: [1, 0, 0, 0, 0, -1, 0, 1, 0],
      offset: [0, 30, 0],
    };
    const renderedPath: Vector3[] = [
      [10.5, 12.5, 14.5],
      [16, 18, 14.5],
    ];
    const renderedRadius: Vector3 = [3, 5, 2];

    const actual = await paint({
      path: renderedPath,
      radius: renderedRadius,
      planeAxis: 2,
      voxelToShapeSpace,
    });
    const expected = await paint({
      path: renderedPath.map(([x, y, z]) => [x, z, 30 - y] as Vector3),
      radius: [renderedRadius[0], renderedRadius[2], renderedRadius[1]],
      planeAxis: 1,
    });
    expect(actual).toEqual(expected);
    expect(expected.size).toBeGreaterThan(50);
  });

  it("paints every voxel that the visible disk passes through for an oblique rotation", async () => {
    const voxelToShapeSpace = rotationAroundX(30, [0, 4, -4]);
    const shapeToVoxel = rotationAroundX(-30, [0, 0, 0]);
    const center: Vector3 = [15.5, 16, 12];
    const radius = 6;
    const painted = await paint({
      path: [center],
      radius: [radius, radius, radius],
      planeAxis: 2,
      voxelToShapeSpace,
    });

    // Sample the disk in the plane and check that the voxel under each sample is
    // painted, which is what the user sees on the rendered plane.
    let sampleCount = 0;
    for (let u = -radius; u <= radius; u += 0.25) {
      for (let v = -radius; v <= radius; v += 0.25) {
        // Stay clear of the border, where the voxel centers decide.
        if (u * u + v * v > (radius - 1) ** 2) continue;
        const pointInShapeSpace: Vector3 = [center[0] + u, center[1] + v, center[2]];
        const withoutOffset = V3sub(pointInShapeSpace, voxelToShapeSpace.offset);
        const voxel = apply(shapeToVoxel, withoutOffset).map(Math.floor) as Vector3;
        expect(painted.has(keyOf(voxel)), `voxel ${voxel} at (${u}, ${v})`).toBe(true);
        sampleCount++;
      }
    }
    expect(sampleCount).toBeGreaterThan(100);

    // Every painted voxel intersects the plane: its center is at most half its
    // extent along the plane normal away from it.
    const halfThickness = 0.5 * (Math.cos(Math.PI / 6) + Math.sin(Math.PI / 6));
    for (const key of painted) {
      const voxel = key.split(",").map(Number) as Vector3;
      const centerInShapeSpace = apply(voxelToShapeSpace, [
        voxel[0] + 0.5,
        voxel[1] + 0.5,
        voxel[2] + 0.5,
      ]);
      expect(Math.abs(centerInShapeSpace[2] - center[2])).toBeLessThanOrEqual(halfThickness + 1e-6);
    }
  });
});

function V3sub(a: Vector3, b: Vector3): Vector3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
