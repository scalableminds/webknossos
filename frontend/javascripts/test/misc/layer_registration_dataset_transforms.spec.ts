import { FIXED_POSITIONS, MOVING_POSITIONS } from "test/fixtures/layer_registration_fixtures";
import type { APIDataset, CoordinateTransformation } from "types/api_types";
import { Identity4x4 } from "viewer/constants";
import { flatToNestedMatrix } from "viewer/model/accessors/dataset_layer_transformation_accessor";
import { createAffineTransform } from "viewer/model/helpers/transformation_helpers";
import {
  getAppliedState,
  getDataLayersWithAppliedTransforms,
  isTransformAppliedToDataset,
} from "viewer/view/layer_registration/layer_registration_dataset_transforms";
import { describe, expect, it } from "vitest";

const transform = createAffineTransform(MOVING_POSITIONS, FIXED_POSITIONS);
const fixedLayerTransforms: CoordinateTransformation[] = [
  { type: "affine", matrix: flatToNestedMatrix(Identity4x4) },
];
// The transforms that the moving layer has after applying the transform.
const appliedTransforms: CoordinateTransformation[] = [
  { type: "affine", matrix: flatToNestedMatrix(transform.affineMatrix) },
  ...fixedLayerTransforms,
];

describe("Layer registration dataset transforms", () => {
  it("recognizes whether the moving layer has the applied transform", () => {
    expect(isTransformAppliedToDataset(transform, fixedLayerTransforms, appliedTransforms)).toBe(
      true,
    );
    expect(isTransformAppliedToDataset(transform, null, appliedTransforms)).toBe(false);
    expect(isTransformAppliedToDataset(transform, fixedLayerTransforms, null)).toBe(false);
  });

  it("tells whether the dataset uses the estimated transform", () => {
    const estimation = { movingToFixedTransform: transform, usedCopiesInNextSlice: false };
    expect(getAppliedState({ errorMessage: "Too few pairs" }, null, null)).toBe("notEnoughPairs");
    expect(getAppliedState(estimation, null, null)).toBe("notApplied");
    expect(getAppliedState(estimation, fixedLayerTransforms, appliedTransforms)).toBe("applied");
  });

  it("applies the transforms of the given moving layers on top of the fixed layer's transforms", () => {
    const oldTransforms: CoordinateTransformation[] = [
      { type: "affine", matrix: flatToNestedMatrix(transform.affineMatrixInv) },
    ];
    const dataLayers = [
      { name: "fixed", coordinateTransformations: fixedLayerTransforms },
      { name: "transformed", coordinateTransformations: oldTransforms },
      { name: "unchanged", coordinateTransformations: oldTransforms },
    ] as APIDataset["dataSource"]["dataLayers"];
    const [fixed, transformed, unchanged] = getDataLayersWithAppliedTransforms(
      dataLayers,
      "fixed",
      new Map([["transformed", transform]]),
    );
    expect(fixed).toBe(dataLayers[0]);
    expect(unchanged).toBe(dataLayers[2]);
    expect(transformed.coordinateTransformations).toEqual(appliedTransforms);
    expect(() =>
      getDataLayersWithAppliedTransforms(dataLayers, "fixed", new Map([["renamed", transform]])),
    ).toThrow('"renamed"');
  });
});
