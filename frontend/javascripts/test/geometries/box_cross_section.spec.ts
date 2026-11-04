import { Euler, Matrix4, Vector3 as ThreeVector3 } from "three";
import type { Vector3 } from "viewer/constants";
import { OrthoViews, OrthoViewValuesWithoutTDView } from "viewer/constants";
import {
  getBoxCrossSection,
  getRotatedViewportNormal,
  intersectBoxWithPlane,
} from "viewer/geometries/helpers/box_cross_section";
import { OrthoBaseRotations } from "viewer/ortho_base_rotations";
import { describe, expect, it } from "vitest";

const min: Vector3 = [10, 20, 30];
const max: Vector3 = [110, 220, 330];
const position: Vector3 = [50, 60, 70];
const noRotation: Vector3 = [0, 0, 0];
const isotropic: Vector3 = [1, 1, 1];
const eps = (value: number) => value - Number.EPSILON;

const dot = (a: Vector3, b: Vector3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a: Vector3, b: Vector3): Vector3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: Vector3, b: Vector3): Vector3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

function expectConvexPolygonOnPlane(corners: Vector3[], pointOnPlane: Vector3, normal: Vector3) {
  for (const corner of corners) {
    expect(dot(sub(corner, pointOnPlane), normal)).toBeCloseTo(0, 6);
    for (let dim = 0; dim < 3; dim++) {
      expect(corner[dim]).toBeGreaterThanOrEqual(min[dim] - 1e-6);
      expect(corner[dim]).toBeLessThanOrEqual(max[dim] + 1e-6);
    }
  }
  // All consecutive edge pairs must turn in the same direction (convex and ordered).
  const turns = corners.map((corner, idx) => {
    const next = corners[(idx + 1) % corners.length];
    const afterNext = corners[(idx + 2) % corners.length];
    return Math.sign(dot(cross(sub(next, corner), sub(afterNext, next)), normal));
  });
  expect(new Set(turns).size).toBe(1);
  expect(turns[0]).not.toBe(0);
}

describe("getBoxCrossSection without rotation", () => {
  it("returns exactly the previous axis-aligned rectangles", () => {
    expect(
      getBoxCrossSection(min, max, OrthoViews.PLANE_XY, position, noRotation, isotropic),
    ).toEqual([
      [10, 20, 70],
      [10, eps(220), 70],
      [eps(110), eps(220), 70],
      [eps(110), 20, 70],
    ]);
    expect(
      getBoxCrossSection(min, max, OrthoViews.PLANE_YZ, position, noRotation, isotropic),
    ).toEqual([
      [50, 20, 30],
      [50, 20, eps(330)],
      [50, eps(220), eps(330)],
      [50, eps(220), 30],
    ]);
    expect(
      getBoxCrossSection(min, max, OrthoViews.PLANE_XZ, position, noRotation, isotropic),
    ).toEqual([
      [10, 60, 30],
      [10, 60, eps(330)],
      [eps(110), 60, eps(330)],
      [eps(110), 60, 30],
    ]);
  });

  it("treats the box as half-open interval", () => {
    const at = (z: number): Vector3 => [50, 60, z];
    const crossSection = (z: number) =>
      getBoxCrossSection(min, max, OrthoViews.PLANE_XY, at(z), noRotation, isotropic);
    expect(crossSection(29.5)).toBeNull();
    expect(crossSection(30)).not.toBeNull();
    expect(crossSection(329.5)).not.toBeNull();
    expect(crossSection(330)).toBeNull();
  });

  it("is not affected by the voxel size", () => {
    expect(
      getBoxCrossSection(min, max, OrthoViews.PLANE_XY, position, noRotation, [4, 4, 40]),
    ).toEqual(getBoxCrossSection(min, max, OrthoViews.PLANE_XY, position, noRotation, isotropic));
  });
});

describe("getRotatedViewportNormal", () => {
  it("matches the orientation of the rotated planes", () => {
    const rotation: Vector3 = [0.3, 1.1, 2.5];
    for (const planeId of OrthoViewValuesWithoutTDView) {
      // Same computation as in Plane.updateToFlycamRotation, applied to the plane's local normal.
      const flycamMatrix = new Matrix4().makeRotationFromEuler(new Euler(...rotation, "ZYX"));
      const baseMatrix = new Matrix4().makeRotationFromEuler(OrthoBaseRotations[planeId]);
      const expected = new ThreeVector3(0, 0, 1).applyMatrix4(flycamMatrix.multiply(baseMatrix));
      const normal = getRotatedViewportNormal(planeId, rotation);
      // The sign of the normal is irrelevant for a plane.
      expect(Math.abs(dot(normal, expected.toArray()))).toBeCloseTo(1, 10);
    }
  });
});

describe("getBoxCrossSection with rotation", () => {
  it("returns the axis-aligned rectangle for rotations by 90°", () => {
    // Rotating by 90° around y turns the XY plane into a plane orthogonal to x.
    const corners = getBoxCrossSection(
      min,
      max,
      OrthoViews.PLANE_XY,
      position,
      [0, Math.PI / 2, 0],
      isotropic,
    );
    expect(corners).toEqual([
      [50, 20, 30],
      [50, 20, eps(330)],
      [50, eps(220), eps(330)],
      [50, eps(220), 30],
    ]);
  });

  it("returns a convex polygon on the rotated plane", () => {
    const rotations: Vector3[] = [
      [0.2, 0, 0],
      [0, 0.4, 0],
      [0.3, 0.5, 0.7],
      [Math.PI / 4, Math.PI / 4, 0],
    ];
    const center: Vector3 = [60, 120, 180];
    for (const planeId of OrthoViewValuesWithoutTDView) {
      for (const rotation of rotations) {
        const corners = getBoxCrossSection(min, max, planeId, center, rotation, isotropic);
        expect(corners).not.toBeNull();
        expect(corners!.length).toBeGreaterThanOrEqual(3);
        expect(corners!.length).toBeLessThanOrEqual(6);
        expectConvexPolygonOnPlane(corners!, center, getRotatedViewportNormal(planeId, rotation));
      }
    }
  });

  it("returns null if the rotated plane misses the box", () => {
    const corners = getBoxCrossSection(
      min,
      max,
      OrthoViews.PLANE_XY,
      [60, 120, 1000],
      [0.1, 0.1, 0],
      isotropic,
    );
    expect(corners).toBeNull();
  });

  it("finds a cross section if the plane only tilts into the box", () => {
    // The position is above the box, so the unrotated plane would miss it.
    const outside: Vector3 = [60, 120, 340];
    const rotation: Vector3 = [0, 0.5, 0];
    expect(
      getBoxCrossSection(min, max, OrthoViews.PLANE_XY, outside, noRotation, isotropic),
    ).toBeNull();
    const corners = getBoxCrossSection(min, max, OrthoViews.PLANE_XY, outside, rotation, isotropic);
    expect(corners).not.toBeNull();
    expectConvexPolygonOnPlane(
      corners!,
      outside,
      getRotatedViewportNormal(OrthoViews.PLANE_XY, rotation),
    );
  });

  it("scales the normal by the voxel size", () => {
    const voxelSize: Vector3 = [1, 1, 10];
    const rotation: Vector3 = [0, 0.3, 0];
    const corners = getBoxCrossSection(
      min,
      max,
      OrthoViews.PLANE_XY,
      position,
      rotation,
      voxelSize,
    );
    const worldNormal = getRotatedViewportNormal(OrthoViews.PLANE_XY, rotation);
    const voxelNormal: Vector3 = [worldNormal[0], worldNormal[1], worldNormal[2] * 10];
    expectConvexPolygonOnPlane(corners!, position, voxelNormal);
  });
});

describe("intersectBoxWithPlane", () => {
  const unitMin: Vector3 = [0, 0, 0];
  const unitMax: Vector3 = [1, 1, 1];

  it("returns a hexagon for the diagonal plane through the center", () => {
    const corners = intersectBoxWithPlane(unitMin, unitMax, [0.5, 0.5, 0.5], [1, 1, 1]);
    expect(corners).toHaveLength(6);
  });

  it("returns a triangle when cutting off a corner", () => {
    const corners = intersectBoxWithPlane(unitMin, unitMax, [0.2, 0, 0], [1, 1, 1]);
    expect(corners).toHaveLength(3);
  });

  it("returns a triangle when the plane passes through three corners", () => {
    const corners = intersectBoxWithPlane(unitMin, unitMax, [1, 0, 0], [1, 1, 1]);
    expect(corners).toHaveLength(3);
  });

  it("returns a quadrilateral when the plane contains a face", () => {
    const corners = intersectBoxWithPlane(unitMin, unitMax, [0, 0, 1], [0, 0, 1]);
    expect(corners).toHaveLength(4);
  });

  it("returns null when the plane only touches an edge or a corner", () => {
    expect(intersectBoxWithPlane(unitMin, unitMax, [1, 1, 0], [1, 1, 0])).toBeNull();
    expect(intersectBoxWithPlane(unitMin, unitMax, [1, 1, 1], [1, 1, 1])).toBeNull();
  });
});
