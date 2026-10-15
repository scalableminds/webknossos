import { getDataset, updateDatasetPartial } from "admin/rest_api";
import { map4 } from "libs/utils";
import { FIXED_POSITIONS, MOVING_POSITIONS } from "test/fixtures/layer_registration_fixtures";
import type { APIDataset, CoordinateTransformation } from "types/api_types";
import { Identity4x4 } from "viewer/constants";
import { flatToNestedMatrix } from "viewer/model/accessors/dataset_layer_transformation_accessor";
import { createAffineTransform, type Transform } from "viewer/model/helpers/transformation_helpers";
import {
  applyTransformsToDataset,
  getAppliedState,
  isTransformAppliedToDataset,
} from "viewer/view/layer_registration/helpers/layer_registration_dataset_transforms";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("admin/rest_api", () => ({ getDataset: vi.fn(), updateDatasetPartial: vi.fn() }));

const transform = createAffineTransform(MOVING_POSITIONS, FIXED_POSITIONS);
const fixedLayerTransforms: CoordinateTransformation[] = [
  { type: "affine", matrix: flatToNestedMatrix(Identity4x4) },
];
// The transforms that the moving layer has after applying the transform.
const appliedTransforms: CoordinateTransformation[] = [
  { type: "affine", matrix: flatToNestedMatrix(transform.affineMatrix) },
  ...fixedLayerTransforms,
];
const oldTransforms: CoordinateTransformation[] = [
  { type: "affine", matrix: flatToNestedMatrix(transform.affineMatrixInv) },
];

// The affine transform that the moving layer gets, with each matrix value changed.
function getAffineTransformWithChangedValues(
  movingToFixedTransform: Transform,
  changeValue: (value: number) => number,
): CoordinateTransformation {
  return {
    type: "affine",
    matrix: map4(
      (row) => map4(changeValue, row),
      flatToNestedMatrix(movingToFixedTransform.affineMatrix),
    ),
  };
}

function createDataset(isActive: boolean) {
  return {
    isActive,
    dataSource: {
      id: { name: "dataset", team: "team" },
      dataLayers: [
        { name: "fixed", coordinateTransformations: fixedLayerTransforms },
        { name: "transformed", coordinateTransformations: oldTransforms },
        { name: "unchanged", coordinateTransformations: oldTransforms },
      ],
    },
  } as unknown as APIDataset;
}

describe("Layer registration dataset transforms", () => {
  beforeEach(() => {
    vi.mocked(getDataset).mockReset();
    vi.mocked(updateDatasetPartial).mockReset();
  });

  it("applies the transform of a moving layer on top of the fixed layer's transforms", async () => {
    const dataset = createDataset(true);
    vi.mocked(getDataset).mockResolvedValue(dataset);

    const layerTransforms = await applyTransformsToDataset(
      "datasetId",
      "fixed",
      new Map([["transformed", transform]]),
    );

    const expectedLayerTransforms = {
      fixed: fixedLayerTransforms,
      transformed: appliedTransforms,
      unchanged: oldTransforms,
    };
    expect(layerTransforms).toEqual(expectedLayerTransforms);
    // All layers and the other fields of the data source are sent, because the server replaces
    // the whole data source.
    const [datasetId, { dataSource }] = vi.mocked(updateDatasetPartial).mock.calls[0];
    expect(datasetId).toBe("datasetId");
    expect(dataSource?.id).toEqual(dataset.dataSource.id);
    expect(
      Object.fromEntries(
        dataSource?.dataLayers.map((layer) => [layer.name, layer.coordinateTransformations]) ?? [],
      ),
    ).toEqual(expectedLayerTransforms);
  });

  it("doesn't change the dataset if a layer is missing or the dataset is inactive", async () => {
    vi.mocked(getDataset).mockResolvedValue(createDataset(true));
    await expect(
      applyTransformsToDataset("datasetId", "fixed", new Map([["renamed", transform]])),
    ).rejects.toThrow('"renamed"');
    await expect(
      applyTransformsToDataset("datasetId", "deleted", new Map([["transformed", transform]])),
    ).rejects.toThrow('"deleted"');

    vi.mocked(getDataset).mockResolvedValue(createDataset(false));
    await expect(
      applyTransformsToDataset("datasetId", "fixed", new Map([["transformed", transform]])),
    ).rejects.toThrow("not active");
    expect(updateDatasetPartial).not.toHaveBeenCalled();
  });

  it("recognizes the applied transform, also if the server stored it less precisely", () => {
    expect(isTransformAppliedToDataset(transform, fixedLayerTransforms, appliedTransforms)).toBe(
      true,
    );
    // The server stores the numbers with fewer digits.
    const roundedTransforms = [
      getAffineTransformWithChangedValues(transform, (value) => Number(value.toPrecision(12))),
      ...fixedLayerTransforms,
    ];
    expect(isTransformAppliedToDataset(transform, fixedLayerTransforms, roundedTransforms)).toBe(
      true,
    );

    const shiftedTransform = createAffineTransform(
      MOVING_POSITIONS,
      FIXED_POSITIONS.map(([x, y, z]) => [x + 0.01, y, z]),
    );
    expect(
      isTransformAppliedToDataset(shiftedTransform, fixedLayerTransforms, appliedTransforms),
    ).toBe(false);
    // The fixed layer's transforms changed since applying.
    expect(isTransformAppliedToDataset(transform, null, appliedTransforms)).toBe(false);
    expect(isTransformAppliedToDataset(transform, fixedLayerTransforms, null)).toBe(false);
  });

  it("recognizes the applied transform if the fixed layer has no transforms", () => {
    // The usual case: the fixed layer is not transformed, so the moving layer gets only its
    // transform.
    const onlyMovingTransform = [appliedTransforms[0]];
    expect(isTransformAppliedToDataset(transform, null, onlyMovingTransform)).toBe(true);
    expect(isTransformAppliedToDataset(transform, [], onlyMovingTransform)).toBe(true);
  });

  it("compares large values relative to their size", () => {
    // Microscopes of different resolutions can need a translation of thousands of voxels.
    const largeTransform = createAffineTransform(
      MOVING_POSITIONS,
      FIXED_POSITIONS.map(([x, y, z]) => [x + 12345.678, y, z]),
    );
    const storedTransforms = [
      getAffineTransformWithChangedValues(largeTransform, (value) => value * (1 + 1e-11)),
    ];
    expect(isTransformAppliedToDataset(largeTransform, null, storedTransforms)).toBe(true);
  });

  it("tells whether the dataset uses the estimated transform", () => {
    const estimation = { movingToFixedTransform: transform, usedCopiesInNextSlice: false };
    expect(getAppliedState({ errorMessage: "Too few pairs" }, null, null)).toBe("notEnoughPairs");
    expect(getAppliedState(estimation, fixedLayerTransforms, oldTransforms)).toBe("notApplied");
    expect(getAppliedState(estimation, fixedLayerTransforms, appliedTransforms)).toBe("applied");
  });
});
