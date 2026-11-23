import { BoxGeometry, Mesh } from "three";
import SegmentLOD from "viewer/controller/segment_lod";
import SegmentMeshController, {
  type MeshSceneNode,
} from "viewer/controller/segment_mesh_controller";
import Store from "viewer/store";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The BVH worker can't be created in the test environment.
vi.mock("libs/compute_bvh_async", () => ({
  computeBvhAsync: vi.fn().mockResolvedValue(undefined),
}));

// Without an annotation, the highlighting of the active segment is skipped.
vi.mock("viewer/model/accessors/volumetracing_accessor", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getActiveSegmentationTracing: () => null,
}));

const LAYER_NAME = "segmentation";
const SEGMENT_ID = 1n;

function createController() {
  const controller = new SegmentMeshController();
  // The material setup of real meshes needs a full store and is irrelevant here.
  vi.spyOn(controller, "constructMesh").mockImplementation(
    (_segmentId, _layerName, geometry) => new Mesh(geometry) as any as MeshSceneNode,
  );
  return controller;
}

function addChunk(controller: SegmentMeshController, lod: number) {
  controller.addMeshFromGeometry(
    new BoxGeometry(1, 1, 1),
    SEGMENT_ID,
    null,
    lod,
    LAYER_NAME,
    null,
    undefined,
    false,
  );
}

function getSegmentLODs(controller: SegmentMeshController): SegmentLOD[] {
  return (controller.getLayerGroup(LAYER_NAME)?.children ?? []).filter(
    (child): child is SegmentLOD => child instanceof SegmentLOD,
  );
}

describe("SegmentMeshController", () => {
  beforeEach(() => {
    vi.spyOn(Store, "getState").mockReturnValue({
      dataset: { dataSource: { scale: { factor: [1, 1, 1] } } },
      localSegmentationStateByLayer: {},
    } as any);
  });
  afterEach(() => vi.restoreAllMocks());

  it("keeps the SegmentLOD when a single LOD is replaced by another one", () => {
    const controller = createController();
    addChunk(controller, 0);
    const [segmentLOD] = getSegmentLODs(controller);

    controller.removeMeshById(SEGMENT_ID, LAYER_NAME, { lod: 0, additionalCoordinates: null });
    addChunk(controller, 1);

    // Otherwise, the hysteresis state of the SegmentLOD would be lost.
    expect(getSegmentLODs(controller)).toEqual([segmentLOD]);
  });

  it("fully removes a segment whose only LOD was removed before", () => {
    const controller = createController();
    addChunk(controller, 0);

    // E.g., the chunks were removed to be replaced by the merged mesh, but loading
    // the merged mesh was cancelled.
    controller.removeMeshById(SEGMENT_ID, LAYER_NAME, { lod: 0, additionalCoordinates: null });
    expect(controller.hasMesh(SEGMENT_ID, LAYER_NAME, null)).toBe(true);
    controller.removeMeshById(SEGMENT_ID, LAYER_NAME, { additionalCoordinates: null });

    expect(controller.hasMesh(SEGMENT_ID, LAYER_NAME, null)).toBe(false);
    expect(getSegmentLODs(controller)).toEqual([]);
  });
});
