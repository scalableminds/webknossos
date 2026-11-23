import {
  BoxGeometry,
  Group,
  Mesh,
  OrthographicCamera,
  PerspectiveCamera,
  Vector3 as ThreeVector3,
} from "three";
import { OrthoViews } from "viewer/constants";
import { updatePerspectiveCameraFromOrthographic } from "viewer/controller/camera_controller";
import SegmentLOD, {
  getLODIndexForVoxelsPerPixel,
  getWorldUnitsPerPixel,
} from "viewer/controller/segment_lod";
import Store from "viewer/store";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const VIEWPORT_HEIGHT_PX = 100;

function mockStore() {
  vi.spyOn(Store, "getState").mockReturnValue({
    dataset: { dataSource: { scale: { factor: [1, 1, 1] }, dataLayers: [] } },
    datasetConfiguration: { nativelyRenderedLayerName: null },
    viewModeData: {
      plane: {
        inputCatcherRects: {
          [OrthoViews.TDView]: {
            top: 0,
            left: 0,
            width: VIEWPORT_HEIGHT_PX,
            height: VIEWPORT_HEIGHT_PX,
          },
        },
      },
    },
  } as any);
}

// Creates a segment with a unit cube at the given position in each of the given LODs.
function createSegmentLOD(position: ThreeVector3, loadedLevels: number[]) {
  const segmentLOD = new SegmentLOD();
  for (const level of loadedLevels) {
    const lodGroup = new Group();
    const mesh = new Mesh(new BoxGeometry(1, 1, 1));
    mesh.position.copy(position);
    lodGroup.add(mesh);
    segmentLOD.addLODMesh(lodGroup, level);
  }
  segmentLOD.updateMatrixWorld(true);
  return segmentLOD;
}

function getVisibleLevel(segmentLOD: SegmentLOD) {
  return segmentLOD.levels.findIndex((level) => level.object.visible);
}

function createPerspectiveCameraLookingDownNegativeZ() {
  const camera = new PerspectiveCamera(45, 1, 0.1, 100000);
  camera.updateMatrixWorld();
  return camera;
}

describe("getLODIndexForVoxelsPerPixel", () => {
  it("picks the coarsest LOD whose threshold is not exceeded", () => {
    expect(getLODIndexForVoxelsPerPixel(0.5, 3)).toBe(0);
    expect(getLODIndexForVoxelsPerPixel(1, 3)).toBe(1);
    expect(getLODIndexForVoxelsPerPixel(4, 3)).toBe(2);
    expect(getLODIndexForVoxelsPerPixel(100, 3)).toBe(3);
    expect(getLODIndexForVoxelsPerPixel(100, 1)).toBe(1);
  });

  it("only switches LODs once the threshold is clearly crossed", () => {
    // The threshold between LOD 0 and 1 is 0.7.
    expect(getLODIndexForVoxelsPerPixel(0.72, 3, 0)).toBe(0);
    expect(getLODIndexForVoxelsPerPixel(0.8, 3, 0)).toBe(1);
    expect(getLODIndexForVoxelsPerPixel(0.68, 3, 1)).toBe(1);
    expect(getLODIndexForVoxelsPerPixel(0.6, 3, 1)).toBe(0);
  });
});

describe("getWorldUnitsPerPixel", () => {
  it("matches the orthographic camera at the target distance of the derived perspective camera", () => {
    const target = new ThreeVector3(0, 0, 0);
    const orthoCamera = new OrthographicCamera(-50, 50, 50, -50, 0, 100000);
    orthoCamera.position.set(0, 0, 10);
    orthoCamera.lookAt(target);
    orthoCamera.updateMatrixWorld();
    const perspectiveCamera = new PerspectiveCamera();
    updatePerspectiveCameraFromOrthographic(orthoCamera, perspectiveCamera, target);
    const distanceToTarget = perspectiveCamera.position.distanceTo(target);

    const orthoPixelSize = getWorldUnitsPerPixel(orthoCamera, 0, VIEWPORT_HEIGHT_PX);
    expect(orthoPixelSize).toBeCloseTo(1);
    expect(
      getWorldUnitsPerPixel(perspectiveCamera, distanceToTarget, VIEWPORT_HEIGHT_PX),
    ).toBeCloseTo(orthoPixelSize);
    // Twice as far away, a pixel covers twice the world size.
    expect(
      getWorldUnitsPerPixel(perspectiveCamera, 2 * distanceToTarget, VIEWPORT_HEIGHT_PX),
    ).toBeCloseTo(2 * orthoPixelSize);
  });
});

describe("SegmentLOD", () => {
  beforeEach(mockStore);
  afterEach(() => vi.restoreAllMocks());

  it("shows finer LODs for segments close to the perspective camera", () => {
    const camera = createPerspectiveCameraLookingDownNegativeZ();
    // A pixel covers ~0.08 voxels at a distance of 10 and ~16 voxels at 2000.
    const nearSegment = createSegmentLOD(new ThreeVector3(0, 0, -10), [0, 1, 2]);
    const farSegment = createSegmentLOD(new ThreeVector3(0, 0, -2000), [0, 1, 2]);

    nearSegment.update(camera);
    farSegment.update(camera);

    expect(getVisibleLevel(nearSegment)).toBe(0);
    expect(getVisibleLevel(farSegment)).toBe(2);
  });

  it("measures the distance to the closest point of the segment", () => {
    const camera = createPerspectiveCameraLookingDownNegativeZ();
    const segmentLOD = new SegmentLOD();
    for (const level of [0, 1, 2]) {
      const lodGroup = new Group();
      // A long segment which reaches from far away to right in front of the camera.
      const mesh = new Mesh(new BoxGeometry(1, 1, 2000));
      mesh.position.set(0, 0, -1005);
      lodGroup.add(mesh);
      segmentLOD.addLODMesh(lodGroup, level);
    }
    segmentLOD.updateMatrixWorld(true);

    segmentLOD.update(camera);

    expect(getVisibleLevel(segmentLOD)).toBe(0);
  });

  it("uses the same LOD for all segments with an orthographic camera", () => {
    // A pixel covers one voxel, independent of the distance.
    const camera = new OrthographicCamera(-50, 50, 50, -50, 0, 100000);
    camera.updateMatrixWorld();
    const nearSegment = createSegmentLOD(new ThreeVector3(0, 0, -10), [0, 1, 2]);
    const farSegment = createSegmentLOD(new ThreeVector3(0, 0, -2000), [0, 1, 2]);

    nearSegment.update(camera);
    farSegment.update(camera);

    expect(getVisibleLevel(nearSegment)).toBe(1);
    expect(getVisibleLevel(farSegment)).toBe(1);
  });

  it("ignores the LOD of previous frames with an orthographic camera", () => {
    // With the perspective camera, the segments settle on different LODs.
    const perspectiveCamera = createPerspectiveCameraLookingDownNegativeZ();
    const nearSegment = createSegmentLOD(new ThreeVector3(0, 0, -10), [0, 1, 2]);
    const farSegment = createSegmentLOD(new ThreeVector3(0, 0, -2000), [0, 1, 2]);
    nearSegment.update(perspectiveCamera);
    farSegment.update(perspectiveCamera);
    expect(getVisibleLevel(nearSegment)).toBe(0);
    expect(getVisibleLevel(farSegment)).toBe(2);

    // A pixel covers 0.72 voxels, which is within the hysteresis band of the
    // threshold between LOD 0 and 1 (0.7).
    const orthoCamera = new OrthographicCamera(-36, 36, 36, -36, 0, 100000);
    orthoCamera.updateMatrixWorld();
    nearSegment.update(orthoCamera);
    farSegment.update(orthoCamera);

    expect(getVisibleLevel(nearSegment)).toBe(1);
    expect(getVisibleLevel(farSegment)).toBe(1);
  });

  it("falls back to the closest loaded LOD while the desired one is still loading", () => {
    const camera = createPerspectiveCameraLookingDownNegativeZ();
    // Only LOD 2 is loaded, LODs 0 and 1 exist as (empty) levels.
    const segmentLOD = createSegmentLOD(new ThreeVector3(0, 0, -10), [2]);

    segmentLOD.update(camera);

    expect(getVisibleLevel(segmentLOD)).toBe(2);
  });

  it("updates its bounds when chunks are added", () => {
    const camera = createPerspectiveCameraLookingDownNegativeZ();
    const segmentLOD = createSegmentLOD(new ThreeVector3(0, 0, -2000), [0, 1, 2]);
    segmentLOD.update(camera);
    expect(getVisibleLevel(segmentLOD)).toBe(2);

    // The world matrix of the new chunk is not updated yet, as it would be the case
    // for chunks that stream in between two frames.
    const nearChunk = new Mesh(new BoxGeometry(1, 1, 1));
    nearChunk.position.set(0, 0, -10);
    segmentLOD.levels[0].object.children[0].add(nearChunk);
    segmentLOD.expandBoundingBox(nearChunk);
    segmentLOD.update(camera);

    expect(getVisibleLevel(segmentLOD)).toBe(0);
  });

  it("shrinks its bounds when chunks are removed", () => {
    const camera = createPerspectiveCameraLookingDownNegativeZ();
    const segmentLOD = createSegmentLOD(new ThreeVector3(0, 0, -2000), [0, 1, 2]);
    const nearGroup = new Group();
    nearGroup.add(new Mesh(new BoxGeometry(1, 1, 1)));
    nearGroup.position.set(0, 0, -10);
    segmentLOD.addLODMesh(nearGroup, 0);
    segmentLOD.expandBoundingBox(nearGroup);
    segmentLOD.update(camera);
    expect(getVisibleLevel(segmentLOD)).toBe(0);

    segmentLOD.removeLODMesh(nearGroup, 0);
    segmentLOD.update(camera);

    expect(getVisibleLevel(segmentLOD)).toBe(2);
  });

  it("updates the LOD when the zoom of the camera changes", () => {
    // A pixel covers one voxel.
    const camera = new OrthographicCamera(-50, 50, 50, -50, 0, 100000);
    camera.updateMatrixWorld();
    const segmentLOD = createSegmentLOD(new ThreeVector3(0, 0, -10), [0, 1, 2]);
    segmentLOD.update(camera);
    expect(getVisibleLevel(segmentLOD)).toBe(1);

    camera.zoom = 10;
    segmentLOD.update(camera);

    expect(getVisibleLevel(segmentLOD)).toBe(0);
  });
});
