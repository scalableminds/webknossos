import { withVoxelSizeTransforms } from "admin/dataset/composition_wizard/04_configure_new_dataset";
import type { APIDataset, LayerLink, VoxelSize } from "types/api_types";
import { UnitLong, type Vector3 } from "viewer/constants";
import {
  buildLiveTransforms,
  combineCoordinateTransformations,
  EXPECTED_LIVE_TRANSFORMATION_LENGTH,
  extractPivotFromTransforms,
  extractSRTFromTransforms,
  hasValidLiveTransformationPattern,
  rebaseTranslationToPivot,
} from "viewer/model/accessors/dataset_layer_transformation_accessor";
import { transformPointUnscaled } from "viewer/model/helpers/transformation_helpers";
import { getFinestVoxelSize } from "viewer/model/scaleinfo";
import { describe, expect, it } from "vitest";

// A layer center the transform editor would rebase onto. Deliberately off-origin and asymmetric, so
// that a rebasing mistake cannot pass unnoticed.
const LAYER_CENTER: Vector3 = [200, 400, 600];

function makeDataset(id: string, voxelSize: VoxelSize): APIDataset {
  // Only the fields that withVoxelSizeTransforms reads are relevant here.
  return { id, dataSource: { scale: voxelSize } } as unknown as APIDataset;
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
  const datasets = [makeDataset("coarse", COARSE), makeDataset("fine", FINE)];
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
      translation: [0, 0, 0],
    });
    // A plain scaling about the origin. The transform editor rebases the pivot onto the layer
    // center when the layer is edited, so it does not have to be expressed that way here.
    expect(extractPivotFromTransforms(coarseLayer.transformations)).toEqual([0, 0, 0]);
  });

  it("should map a voxel to p * scale", () => {
    const [coarseLayer] = withVoxelSizeTransforms(layers, datasets, targetVoxelSize);
    const transform = combineCoordinateTransformations(coarseLayer.transformations, [1, 1, 1]);

    expect(transformPointUnscaled(transform)([0, 0, 0])).toEqual([0, 0, 0]);
    expect(transformPointUnscaled(transform)([10, 20, 30])).toEqual([30, 60, 90]);
  });

  it("should survive the editor rebasing the pivot onto the layer center", () => {
    // This is what the layer transform popover does when such a layer is opened: the pivot moves to
    // the layer's center and the translation absorbs the difference, leaving the layer in place.
    const [coarseLayer] = withVoxelSizeTransforms(layers, datasets, targetVoxelSize);
    const srt = extractSRTFromTransforms(coarseLayer.transformations);
    const rebased = buildLiveTransforms(
      srt.scale,
      srt.rotation,
      rebaseTranslationToPivot(srt, [0, 0, 0], LAYER_CENTER),
      LAYER_CENTER,
    );

    const before = combineCoordinateTransformations(coarseLayer.transformations, [1, 1, 1]);
    const after = combineCoordinateTransformations(rebased, [1, 1, 1]);
    for (const point of [[0, 0, 0], [10, 20, 30], LAYER_CENTER] as Vector3[]) {
      expect(transformPointUnscaled(after)(point)).toEqual(transformPointUnscaled(before)(point));
    }
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
      makeDataset("a", { factor: [4, 8, 40], unit: UnitLong.nm } as VoxelSize),
      makeDataset("b", { factor: [2, 2, 10], unit: UnitLong.nm } as VoxelSize),
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
