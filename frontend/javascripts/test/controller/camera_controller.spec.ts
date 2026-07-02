import { OrthographicCamera, PerspectiveCamera, Vector3 as ThreeVector3 } from "three";
import { updatePerspectiveCameraFromOrthographic } from "viewer/controller/camera_controller";
import { describe, expect, it } from "vitest";

function createOrthoCamera(
  position: ThreeVector3,
  target: ThreeVector3,
  frustum: { left: number; right: number; top: number; bottom: number },
) {
  const orthoCamera = new OrthographicCamera(
    frustum.left,
    frustum.right,
    frustum.top,
    frustum.bottom,
    0,
    8000000,
  );
  orthoCamera.up.set(0, 0, -1);
  orthoCamera.position.copy(position);
  orthoCamera.lookAt(target);
  orthoCamera.updateMatrixWorld();
  orthoCamera.updateProjectionMatrix();
  return orthoCamera;
}

// Returns the world position of a point on the plane through the target
// (perpendicular to the viewing direction) given camera-space x/y offsets.
function getPointOnTargetPlane(
  orthoCamera: OrthographicCamera,
  target: ThreeVector3,
  x: number,
  y: number,
) {
  const rightVec = new ThreeVector3().setFromMatrixColumn(orthoCamera.matrixWorld, 0);
  const upVec = new ThreeVector3().setFromMatrixColumn(orthoCamera.matrixWorld, 1);
  return target.clone().addScaledVector(rightVec, x).addScaledVector(upVec, y);
}

describe("updatePerspectiveCameraFromOrthographic", () => {
  const target = new ThreeVector3(10, 20, 30);
  const position = new ThreeVector3(500, -300, 400);
  const frustum = { left: -120, right: 80, top: 90, bottom: -60 };

  it("should project points on the target plane to the same screen coordinates as the orthographic camera", () => {
    const orthoCamera = createOrthoCamera(position, target, frustum);
    const perspectiveCamera = new PerspectiveCamera();
    updatePerspectiveCameraFromOrthographic(orthoCamera, perspectiveCamera, target);
    expect(perspectiveCamera.userData.isDerived).toBe(true);

    const middleX = (frustum.left + frustum.right) / 2;
    const middleY = (frustum.top + frustum.bottom) / 2;
    // The four corners of the visible rectangle plus an arbitrary interior point.
    const testOffsets: Array<{ x: number; y: number; expectedNdc?: [number, number] }> = [
      { x: frustum.left, y: frustum.bottom, expectedNdc: [-1, -1] },
      { x: frustum.right, y: frustum.bottom, expectedNdc: [1, -1] },
      { x: frustum.left, y: frustum.top, expectedNdc: [-1, 1] },
      { x: frustum.right, y: frustum.top, expectedNdc: [1, 1] },
      { x: middleX + 13, y: middleY - 27 },
    ];

    for (const { x, y, expectedNdc } of testOffsets) {
      const worldPoint = getPointOnTargetPlane(orthoCamera, target, x, y);
      const orthoNdc = worldPoint.clone().project(orthoCamera);
      const perspectiveNdc = worldPoint.clone().project(perspectiveCamera);
      expect(perspectiveNdc.x).toBeCloseTo(orthoNdc.x, 6);
      expect(perspectiveNdc.y).toBeCloseTo(orthoNdc.y, 6);
      if (expectedNdc != null) {
        expect(perspectiveNdc.x).toBeCloseTo(expectedNdc[0], 6);
        expect(perspectiveNdc.y).toBeCloseTo(expectedNdc[1], 6);
      }
    }
  });

  it("should keep a target plane point fixed on screen when zooming (like the orthographic camera does)", () => {
    const orthoCamera = createOrthoCamera(position, target, frustum);
    const perspectiveCamera = new PerspectiveCamera();
    updatePerspectiveCameraFromOrthographic(orthoCamera, perspectiveCamera, target);

    // A point on the target plane which the zoom should keep fixed.
    const fixedPoint = getPointOnTargetPlane(orthoCamera, target, 40, -10);
    const ndcBefore = fixedPoint.clone().project(perspectiveCamera);

    // Shrink the frustum around the fixed point (mimicking zoomTDView with zoomToMouse).
    const zoomFactor = 0.9;
    for (const side of ["left", "right"] as const) {
      orthoCamera[side] = 40 + (orthoCamera[side] - 40) * zoomFactor;
    }
    for (const side of ["top", "bottom"] as const) {
      orthoCamera[side] = -10 + (orthoCamera[side] + 10) * zoomFactor;
    }
    orthoCamera.updateProjectionMatrix();
    updatePerspectiveCameraFromOrthographic(orthoCamera, perspectiveCamera, target);

    const ndcAfter = fixedPoint.clone().project(perspectiveCamera);
    expect(ndcAfter.x).toBeCloseTo(ndcBefore.x, 6);
    expect(ndcAfter.y).toBeCloseTo(ndcBefore.y, 6);
  });

  it("should not touch the perspective camera when the orthographic frustum is degenerate", () => {
    const orthoCamera = new OrthographicCamera(0, 0, 0, 0);
    const perspectiveCamera = new PerspectiveCamera();
    const originalPosition = perspectiveCamera.position.clone();
    updatePerspectiveCameraFromOrthographic(orthoCamera, perspectiveCamera, target);
    expect(perspectiveCamera.userData.isDerived).toBeUndefined();
    expect(perspectiveCamera.position.equals(originalPosition)).toBe(true);
  });

  it("should use valid near/far values for tiny and huge frusta", () => {
    for (const scale of [1e-3, 1, 1e7]) {
      const scaledFrustum = {
        left: frustum.left * scale,
        right: frustum.right * scale,
        top: frustum.top * scale,
        bottom: frustum.bottom * scale,
      };
      const orthoCamera = createOrthoCamera(position, target, scaledFrustum);
      const perspectiveCamera = new PerspectiveCamera();
      updatePerspectiveCameraFromOrthographic(orthoCamera, perspectiveCamera, target);
      const distance = perspectiveCamera.position.distanceTo(target);
      expect(perspectiveCamera.near).toBeGreaterThan(0);
      expect(perspectiveCamera.near).toBeLessThan(distance);
      expect(perspectiveCamera.far).toBeGreaterThan(distance);
    }
  });
});
