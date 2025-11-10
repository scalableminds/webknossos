import { getRotationalTransformation } from "dashboard/dataset/dataset_rotation_form_item";
import type { CoordinateTransformation } from "types/api_types";
import { IdentityTransform, type OrthoView } from "viewer/constants";
import { combineCoordinateTransformations } from "viewer/model/accessors/dataset_layer_transformation_accessor";
import BoundingBox from "viewer/model/bucket_data_handling/bounding_box";
import type { Transform } from "viewer/model/helpers/transformation_helpers";
import { mapTransformedPlane as originalMapTransformedPlane } from "viewer/model/volumetracing/section_labeling";
import { describe, expect, it } from "vitest";

const mapTransformedPlane = (plane: OrthoView, transform: Transform) => {
  const [transformedPlane, isSwapped, adaptFn] = originalMapTransformedPlane(plane, transform);
  const adaptedScale = adaptFn([0, 1, 2]);
  return [transformedPlane, isSwapped, adaptedScale];
};

describe("TransformedSectionLabeler", () => {
  it("Identity transform should result in identity mapping of plane", async () => {
    expect(mapTransformedPlane("PLANE_XY", IdentityTransform)).toEqual(["PLANE_XY", false, [0, 1]]);
    expect(mapTransformedPlane("PLANE_YZ", IdentityTransform)).toEqual(["PLANE_YZ", false, [2, 1]]);
    expect(mapTransformedPlane("PLANE_XZ", IdentityTransform)).toEqual(["PLANE_XZ", false, [0, 2]]);
  });

  it("Rotation by 90deg around X should be handled correctly", async () => {
    const rotationalTransform = combineCoordinateTransformations(
      getRotationalTransformation(new BoundingBox({ min: [5, 10, 15], max: [105, 115, 120] }), {
        x: { rotationInDegrees: 90, isMirrored: false },
        y: { rotationInDegrees: 0, isMirrored: false },
        z: { rotationInDegrees: 0, isMirrored: false },
      }),
      [1, 2, 3],
    );

    expect(mapTransformedPlane("PLANE_XY", rotationalTransform)).toEqual([
      "PLANE_XZ",
      false,
      [0, 1],
    ]);
    expect(mapTransformedPlane("PLANE_YZ", rotationalTransform)).toEqual([
      "PLANE_YZ",
      true,
      [1, 2],
    ]);
    expect(mapTransformedPlane("PLANE_XZ", rotationalTransform)).toEqual([
      "PLANE_XY",
      false,
      [0, 2],
    ]);
  });

  it("[L4] Rotation by 90deg around X should be handled correctly", async () => {
    const coordinateTransformations = [
      {
        matrix: [
          [1, 0, 0, -1529],
          [0, 1, 0, -1478],
          [0, 0, 1, -1476],
          [0, 0, 0, 1],
        ],
        type: "affine" as const,
      },
      {
        matrix: [
          [1, 0, 0, 0],
          [0, 0, -1, 0],
          [0, 1, 0, 0],
          [0, 0, 0, 1],
        ],
        type: "affine" as const,
      },
      {
        matrix: [
          [1, 0, 0, 1529],
          [0, 1, 0, 1478],
          [0, 0, 1, 1476],
          [0, 0, 0, 1],
        ],
        type: "affine" as const,
      },
    ] as CoordinateTransformation[];

    const rotationalTransform = combineCoordinateTransformations(
      coordinateTransformations,
      [11, 19, 28],
    );

    expect(mapTransformedPlane("PLANE_XY", rotationalTransform)).toEqual([
      "PLANE_XZ",
      false,
      [0, 1],
    ]);
    expect(mapTransformedPlane("PLANE_YZ", rotationalTransform)).toEqual([
      "PLANE_YZ",
      true,
      [1, 2],
    ]);
    expect(mapTransformedPlane("PLANE_XZ", rotationalTransform)).toEqual([
      "PLANE_XY",
      false,
      [0, 2],
    ]);
  });

  it("[L4] Rotation by 90deg around Z should be handled correctly", async () => {
    const coordinateTransformations = [
      {
        type: "affine" as const,
        matrix: [
          [1, 0, 0, -1529],
          [0, 1, 0, -1478],
          [0, 0, 1, -1476],
          [0, 0, 0, 1],
        ],
      },
      {
        type: "affine" as const,
        matrix: [
          [1, 0, 0, 0],
          [0, 1, 0, 0],
          [0, 0, 1, 0],
          [0, 0, 0, 1],
        ],
      },
      {
        type: "affine" as const,
        matrix: [
          [1, 0, 0, 0],
          [0, 1, 0, 0],
          [0, 0, 1, 0],
          [0, 0, 0, 1],
        ],
      },
      {
        type: "affine" as const,
        matrix: [
          [0, -1, 0, 0],
          [1, 0, 0, 0],
          [0, 0, 1, 0],
          [0, 0, 0, 1],
        ],
      },
      {
        type: "affine" as const,
        matrix: [
          [1, 0, 0, 1529],
          [0, 1, 0, 1478],
          [0, 0, 1, 1476],
          [0, 0, 0, 1],
        ],
      },
    ] as CoordinateTransformation[];

    const rotationalTransform = combineCoordinateTransformations(
      coordinateTransformations,
      [11, 19, 28],
    );

    expect(mapTransformedPlane("PLANE_XY", rotationalTransform)).toEqual([
      "PLANE_XY",
      true,
      [1, 0],
    ]);
    expect(mapTransformedPlane("PLANE_YZ", rotationalTransform)).toEqual([
      "PLANE_XZ",
      false,
      [1, 2],
    ]);
    expect(mapTransformedPlane("PLANE_XZ", rotationalTransform)).toEqual([
      "PLANE_YZ",
      false,
      [2, 0],
    ]);
  });

  // Todo #8965. Does not work yet
  it.skip("[L4] Rotation by 90deg around all axes should be handled correctly", async () => {
    const coordinateTransformations = [
      {
        type: "affine",
        matrix: [
          [1, 0, 0, -1529],
          [0, 1, 0, -1478],
          [0, 0, 1, -1476],
          [0, 0, 0, 1],
        ],
      },
      {
        type: "affine",
        matrix: [
          [1, 0, 0, 0],
          [0, 0, -1, 0],
          [0, 1, 0, 0],
          [0, 0, 0, 1],
        ],
      },
      {
        type: "affine",
        matrix: [
          [0, 0, 1, 0],
          [0, 1, 0, 0],
          [-1, 0, 0, 0],
          [0, 0, 0, 1],
        ],
      },
      {
        type: "affine",
        matrix: [
          [0, -1, 0, 0],
          [1, 0, 0, 0],
          [0, 0, 1, 0],
          [0, 0, 0, 1],
        ],
      },
      {
        type: "affine",
        matrix: [
          [1, 0, 0, 1529],
          [0, 1, 0, 1478],
          [0, 0, 1, 1476],
          [0, 0, 0, 1],
        ],
      },
    ] as CoordinateTransformation[];

    const rotationalTransform = combineCoordinateTransformations(
      coordinateTransformations,
      [11, 19, 28],
    );

    expect(mapTransformedPlane("PLANE_XY", rotationalTransform)).toEqual([
      "PLANE_YZ",
      false,
      [0, 1],
    ]);
    expect(mapTransformedPlane("PLANE_YZ", rotationalTransform)).toEqual([
      "PLANE_XY",
      false,
      [2, 1],
    ]);
    expect(mapTransformedPlane("PLANE_XZ", rotationalTransform)).toEqual([
      "PLANE_XZ",
      true,
      [2, 0],
    ]);
  });
});
