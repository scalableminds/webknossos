import { withVoxelSizeTransforms } from "admin/dataset/composition_wizard/04_configure_new_dataset";
import type { APIDataset, LayerLink, VoxelSize } from "types/api_types";
import { UnitLong, type Vector3 } from "viewer/constants";
import {
  combineCoordinateTransformations,
  EXPECTED_LIVE_TRANSFORMATION_LENGTH,
  extractPivotFromTransforms,
  extractSRTFromTransforms,
  hasValidLiveTransformationPattern,
} from "viewer/model/accessors/dataset_layer_transformation_accessor";
import { transformPointUnscaled } from "viewer/model/helpers/transformation_helpers";
import { getFinestVoxelSize } from "viewer/model/scaleinfo";
import { describe, expect, it } from "vitest";

// The layer's bounding box center, which withVoxelSizeTransforms uses as the pivot. Deliberately
// off-origin and asymmetric, so that a wrong pivot cannot pass unnoticed.
const LAYER_TOP_LEFT = [100, 200, 300];
const LAYER_SIZE = { width: 200, height: 400, depth: 600 };
const LAYER_CENTER: Vector3 = [200, 400, 600];

function makeDataset(id: string, voxelSize: VoxelSize, layerNames: string[]): APIDataset {
  // Only the fields that withVoxelSizeTransforms reads are relevant here.
  return {
    id,
    dataSource: {
      scale: voxelSize,
      dataLayers: layerNames.map((name) => ({
        name,
        boundingBox: { topLeft: LAYER_TOP_LEFT, ...LAYER_SIZE },
      })),
    },
  } as unknown as APIDataset;
}

function makeLayerLink(sourceDatasetId: string, name: string): LayerLink {
  return {
    sourceDatasetId,
    sourceDatasetName: sourceDatasetId,
    sourceLayerName: name,
    targetLayerName: name,
    transformations: [],
  };
}

const COARSE = { factor: [6, 6, 6], unit: UnitLong.nm } as VoxelSize;
const FINE = { factor: [2, 2, 2], unit: UnitLong.nm } as VoxelSize;

describe("withVoxelSizeTransforms", () => {
  const datasets = [
    makeDataset("coarse", COARSE, ["coarse_layer"]),
    makeDataset("fine", FINE, ["fine_layer"]),
  ];
  const layers = [makeLayerLink("coarse", "coarse_layer"), makeLayerLink("fine", "fine_layer")];
  const targetVoxelSize = getFinestVoxelSize(datasets.map((d) => d.dataSource.scale));

  it("should use the finest voxel size as the target", () => {
    expect(targetVoxelSize).toEqual(FINE);
  });

  it("should emit the scaling in the editable 7-matrix format", () => {
    const [coarseLayer] = withVoxelSizeTransforms(layers, datasets, targetVoxelSize);

    expect(coarseLayer.transformations).toHaveLength(EXPECTED_LIVE_TRANSFORMATION_LENGTH);
    // The Layer Transforms editor must accept the generated transforms and read back the scaling.
    expect(hasValidLiveTransformationPattern(coarseLayer.transformations)).toBe(true);
    expect(extractSRTFromTransforms(coarseLayer.transformations)).toEqual({
      scale: [3, 3, 3],
      rotation: [0, 0, 0],
      // Compensates for pivoting about the layer center instead of the origin: center * (scale - 1).
      translation: [400, 800, 1200],
    });
  });

  it("should pivot about the layer center, like the transforms editor does", () => {
    const [coarseLayer] = withVoxelSizeTransforms(layers, datasets, targetVoxelSize);

    expect(extractPivotFromTransforms(coarseLayer.transformations)).toEqual(LAYER_CENTER);
  });

  it("should map a voxel to p * scale despite the non-zero pivot", () => {
    const [coarseLayer] = withVoxelSizeTransforms(layers, datasets, targetVoxelSize);
    const transform = combineCoordinateTransformations(coarseLayer.transformations, [1, 1, 1]);

    expect(transformPointUnscaled(transform)([0, 0, 0])).toEqual([0, 0, 0]);
    expect(transformPointUnscaled(transform)([10, 20, 30])).toEqual([30, 60, 90]);
    expect(transformPointUnscaled(transform)(LAYER_CENTER)).toEqual([600, 1200, 1800]);
  });

  it("should not add an identity transform for the layer that already matches", () => {
    const [, fineLayer] = withVoxelSizeTransforms(layers, datasets, targetVoxelSize);

    expect(fineLayer.transformations).toEqual([]);
  });

  it("should append to transformations that are already present", () => {
    const existing = { type: "affine" as const, matrix: [[1, 0, 0, 5]] as any };
    const layersWithExisting = [
      { ...makeLayerLink("coarse", "coarse_layer"), transformations: [existing] },
    ];

    const [layer] = withVoxelSizeTransforms(layersWithExisting, datasets, targetVoxelSize);

    expect(layer.transformations).toHaveLength(1 + EXPECTED_LIVE_TRANSFORMATION_LENGTH);
    expect(layer.transformations[0]).toBe(existing);
  });

  it("should leave layers of unknown datasets untouched", () => {
    const orphan = [makeLayerLink("does_not_exist", "orphan_layer")];

    expect(withVoxelSizeTransforms(orphan, datasets, targetVoxelSize)[0].transformations).toEqual(
      [],
    );
  });

  it("should handle anisotropic voxel sizes per axis", () => {
    const anisotropicDatasets = [
      makeDataset("a", { factor: [4, 8, 40], unit: UnitLong.nm } as VoxelSize, ["layer_a"]),
      makeDataset("b", { factor: [2, 2, 10], unit: UnitLong.nm } as VoxelSize, ["layer_b"]),
    ];
    const target = getFinestVoxelSize(anisotropicDatasets.map((d) => d.dataSource.scale));
    const [layerA] = withVoxelSizeTransforms(
      [makeLayerLink("a", "layer_a")],
      anisotropicDatasets,
      target,
    );

    expect(target).toEqual({ factor: [2, 2, 10], unit: UnitLong.nm });
    expect(hasValidLiveTransformationPattern(layerA.transformations)).toBe(true);
    expect(extractSRTFromTransforms(layerA.transformations).scale).toEqual([2, 4, 4]);
  });
});
