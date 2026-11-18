import { getRotationalTransformation } from "dashboard/dataset/dataset_rotation_form_item";
import update from "immutability-helper";
import { initialState } from "test/fixtures/hybridtracing_object";
import type { APIDataset, CoordinateTransformation } from "types/api_types";
import { UnitLong, type Vector3 } from "viewer/constants";
import {
  getGlobalVoxelSize,
  makeScaleMatrix,
} from "viewer/model/accessors/dataset_layer_transformation_accessor";
import BoundingBox from "viewer/model/bucket_data_handling/bounding_box";
import { describe, expect, it } from "vitest";

const VOXEL_SIZE: Vector3 = [11, 19, 28];
const BBOX = new BoundingBox({ min: [0, 0, 0], max: [100, 200, 300] });

const ROTATE_Z_90: CoordinateTransformation = {
  type: "affine",
  matrix: [
    [0, -1, 0, 0],
    [1, 0, 0, 0],
    [0, 0, 1, 0],
    [0, 0, 0, 1],
  ],
};

function rotationForAllAxes(degrees: { x?: number; y?: number; z?: number; mirrorX?: boolean }) {
  return getRotationalTransformation(BBOX, {
    x: { rotationInDegrees: degrees.x ?? 0, isMirrored: degrees.mirrorX ?? false },
    y: { rotationInDegrees: degrees.y ?? 0, isMirrored: false },
    z: { rotationInDegrees: degrees.z ?? 0, isMirrored: false },
  });
}

function createDataset(
  transformsPerLayer: Array<CoordinateTransformation[] | null>,
  voxelSize: Vector3 = VOXEL_SIZE,
): APIDataset {
  const [firstLayer] = initialState.dataset.dataSource.dataLayers;
  return update(initialState.dataset, {
    dataSource: {
      scale: { $set: { factor: voxelSize, unit: UnitLong.nm } },
      dataLayers: {
        $set: transformsPerLayer.map((coordinateTransformations, index) => ({
          ...firstLayer,
          name: `layer${index}`,
          coordinateTransformations,
        })),
      },
    },
  });
}

function expectVoxelSize(actual: Vector3, expected: Vector3) {
  for (let i = 0; i < 3; i++) {
    expect(actual[i]).toBeCloseTo(expected[i], 9);
  }
}

describe("Global voxel size", () => {
  it("should be the dataset's voxel size without transforms", () => {
    const dataset = createDataset([null, null]);
    expect(getGlobalVoxelSize(dataset, null)).toEqual(dataset.dataSource.scale);
    expect(getGlobalVoxelSize(dataset, "layer0")).toEqual(dataset.dataSource.scale);
  });

  it("should permute the voxel size when all layers are rotated by 90° around x", () => {
    const rotation = rotationForAllAxes({ x: 90 });
    const dataset = createDataset([rotation, rotation]);
    expectVoxelSize(getGlobalVoxelSize(dataset, null).factor, [11, 28, 19]);
    // Rendering natively shows all layers without their (common) transforms.
    expect(getGlobalVoxelSize(dataset, "layer0")).toEqual(dataset.dataSource.scale);
  });

  it("should permute the voxel size when the axes are cycled by two rotations", () => {
    // Rotating by 90° around x and then around z maps x to y, y to z and z to x.
    const rotation = rotationForAllAxes({ x: 90, z: 90 });
    const dataset = createDataset([rotation, rotation]);
    expectVoxelSize(getGlobalVoxelSize(dataset, null).factor, [28, 11, 19]);
  });

  it("should keep the voxel size when mirroring", () => {
    const mirroring = rotationForAllAxes({ mirrorX: true });
    const dataset = createDataset([mirroring, mirroring]);
    expectVoxelSize(getGlobalVoxelSize(dataset, null).factor, VOXEL_SIZE);
  });

  it("should scale the voxel size when a scaled layer is rendered natively", () => {
    const dataset = createDataset([null, [makeScaleMatrix(2, 1, 0.5)]]);
    // Without a natively rendered layer, the global space is the untransformed space.
    expect(getGlobalVoxelSize(dataset, null)).toEqual(dataset.dataSource.scale);
    expect(getGlobalVoxelSize(dataset, "layer0")).toEqual(dataset.dataSource.scale);
    expectVoxelSize(getGlobalVoxelSize(dataset, "layer1").factor, [22, 19, 14]);
  });

  it("should scale and permute the voxel size for a natively rendered, scaled and rotated layer", () => {
    // The layer is first scaled by 2 in x and then rotated by 90° around z, so that its
    // x axis ends up along y.
    const dataset = createDataset([null, [makeScaleMatrix(2, 1, 1), ROTATE_Z_90]]);
    expectVoxelSize(getGlobalVoxelSize(dataset, "layer1").factor, [38, 11, 28]);
  });

  it("should fall back to the dataset's voxel size for oblique rotations of anisotropic voxels", () => {
    const rotation = rotationForAllAxes({ z: 45 });
    const dataset = createDataset([rotation, rotation]);
    expect(getGlobalVoxelSize(dataset, null)).toEqual(dataset.dataSource.scale);
  });

  it("should keep isotropic voxel sizes for oblique rotations", () => {
    const rotation = rotationForAllAxes({ z: 45 });
    const dataset = createDataset([rotation, rotation], [10, 10, 10]);
    expectVoxelSize(getGlobalVoxelSize(dataset, null).factor, [10, 10, 10]);
  });

  it("should return the same instance for equal voxel sizes", () => {
    const rotation = rotationForAllAxes({ x: 90 });
    const voxelSize = getGlobalVoxelSize(createDataset([rotation, rotation]), null);
    const voxelSizeForOtherDataset = getGlobalVoxelSize(createDataset([rotation, rotation]), null);
    expect(voxelSizeForOtherDataset).toBe(voxelSize);
  });
});
