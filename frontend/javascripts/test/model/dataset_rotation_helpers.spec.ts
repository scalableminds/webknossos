import isEqual from "lodash-es/isEqual";
import { Euler, Matrix4, Quaternion, Vector3 as ThreeVector3 } from "three";
import type { AffineTransformation, APIDataLayer, CoordinateTransformation } from "types/api_types";
import type { NestedMatrix4, Vector3 } from "viewer/constants";
import BoundingBox from "viewer/model/bucket_data_handling/bounding_box";
import {
  doAllLayersHaveTheSameRotation,
  fromCenterToOriginAsAffine,
  fromOriginToCenterAsAffine,
  getRotationMatrixAroundAxis,
  isTranslationOnly,
  type RotationAndMirroringSettings,
} from "viewer/model/helpers/dataset_rotation_helpers";
import {
  flatToNestedMatrix,
  nestedToFlatMatrix,
} from "viewer/model/helpers/transformation_helpers";
import { describe, expect, it } from "vitest";

// The dataset rotation helpers used to be implemented with three.js. They were reimplemented without
// it so that three.js is only loaded with the viewer. These tests compare them to the former
// three.js-based implementations, which are kept here as a reference.
const reference = {
  toAffine(m: Matrix4): AffineTransformation {
    return { type: "affine", matrix: flatToNestedMatrix(m.clone().transpose().toArray()) };
  },
  fromCenterToOriginAsAffine(bbox: BoundingBox): AffineTransformation {
    const center = bbox.getCenter();
    return reference.toAffine(new Matrix4().makeTranslation(-center[0], -center[1], -center[2]));
  },
  fromOriginToCenterAsAffine(bbox: BoundingBox): AffineTransformation {
    const center = bbox.getCenter();
    return reference.toAffine(new Matrix4().makeTranslation(center[0], center[1], center[2]));
  },
  getRotationMatrixAroundAxis(
    axis: "x" | "y" | "z",
    settings: RotationAndMirroringSettings,
  ): AffineTransformation {
    const euler = new Euler();
    euler[axis] = settings.rotationInDegrees * (Math.PI / 180);
    let rotationMatrix = new Matrix4().makeRotationFromEuler(euler);
    if (settings.isMirrored) {
      const scaleVector = new ThreeVector3(1, 1, 1);
      scaleVector[axis] = -1;
      rotationMatrix = rotationMatrix.multiply(
        new Matrix4().makeScale(scaleVector.x, scaleVector.y, scaleVector.z),
      );
    }
    const matrix = rotationMatrix
      .transpose()
      .toArray()
      .map((value) => (Math.abs(value) < Number.EPSILON ? 0 : value));
    return { type: "affine", matrix: flatToNestedMatrix(matrix as Matrix4["elements"] as any) };
  },
  decompose(transformation: AffineTransformation) {
    const translation = new ThreeVector3();
    const quaternion = new Quaternion();
    const scale = new ThreeVector3();
    new Matrix4()
      .fromArray(nestedToFlatMatrix(transformation.matrix))
      .transpose()
      .decompose(translation, quaternion, scale);
    return { translation, quaternion, scale };
  },
  isTranslationOnly(transformation: AffineTransformation) {
    const { quaternion, scale } = reference.decompose(transformation);
    return scale.equals(new ThreeVector3(1, 1, 1)) && quaternion.angleTo(new Quaternion()) < 0.0001;
  },
  isOnlyRotatedOrMirrored(transformation: AffineTransformation) {
    const { translation, scale } = reference.decompose(transformation);
    return (
      translation.length() === 0 &&
      isEqual([Math.abs(scale.x), Math.abs(scale.y), Math.abs(scale.z)], [1, 1, 1])
    );
  },
};

// Deterministic pseudo random numbers (mulberry32), so that failures are reproducible.
function createRandom(seed: number) {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const AXES = ["x", "y", "z"] as const;
const ROTATIONS_IN_90_DEGREE_STEPS = [0, 90, 180, 270];

function affine(matrix: NestedMatrix4): AffineTransformation {
  return { type: "affine", matrix };
}

function translation(x: number, y: number, z: number): AffineTransformation {
  return affine([
    [1, 0, 0, x],
    [0, 1, 0, y],
    [0, 0, 1, z],
    [0, 0, 0, 1],
  ]);
}

// Matrices which are (almost) valid parts of the dataset rotation pattern as well as ones which
// are not, to exercise the pattern checks on both sides of their decisions.
function getCandidateMatrices(): AffineTransformation[] {
  const random = createRandom(42);
  const candidates: AffineTransformation[] = [translation(0, 0, 0), translation(-0, 0, -0)];
  for (let i = 0; i < 20; i++) {
    candidates.push(translation(random() * 2000 - 1000, random() * 2000 - 1000, random() * 10));
  }
  for (const axis of AXES) {
    for (const rotationInDegrees of [...ROTATIONS_IN_90_DEGREE_STEPS, 0.001, 0.01, 1, 45, 137]) {
      for (const isMirrored of [false, true]) {
        const rotation = reference.getRotationMatrixAroundAxis(axis, {
          rotationInDegrees,
          isMirrored,
        });
        candidates.push(rotation);
        // The same rotation, but with a translation.
        candidates.push(
          affine(
            rotation.matrix.map((row, rowIndex) =>
              rowIndex < 3 ? [row[0], row[1], row[2], 5] : row,
            ) as NestedMatrix4,
          ),
        );
      }
    }
  }
  // Scaled, sheared, degenerate and random matrices
  candidates.push(
    affine([
      [2, 0, 0, 0],
      [0, 1, 0, 0],
      [0, 0, 1, 0],
      [0, 0, 0, 1],
    ]),
    affine([
      [1, 0.5, 0, 0],
      [0, 1, 0, 0],
      [0, 0, 1, 0],
      [0, 0, 0, 1],
    ]),
    affine([
      [0, -1, 1, 0],
      [1, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 1],
    ]),
    affine([
      [-1, 0, 0, 3],
      [0, 1, 0, 0],
      [0, 0, 1, 0],
      [0, 0, 0, 1],
    ]),
    affine([
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 1],
    ]),
  );
  for (let i = 0; i < 50; i++) {
    const value = () => (random() < 0.3 ? 0 : random() * 4 - 2);
    candidates.push(
      affine([
        [value(), value(), value(), value()],
        [value(), value(), value(), value()],
        [value(), value(), value(), value()],
        [0, 0, 0, 1],
      ]),
    );
  }
  return candidates;
}

function createLayer(coordinateTransformations: CoordinateTransformation[]): APIDataLayer {
  return {
    name: "color",
    category: "color",
    elementClass: "uint8",
    boundingBox: { topLeft: [0, 0, 0], width: 100, height: 100, depth: 100 },
    resolutions: [[1, 1, 1]],
    coordinateTransformations,
  } as unknown as APIDataLayer;
}

describe("Dataset rotation helpers", () => {
  it("getRotationMatrixAroundAxis should equal the three.js implementation for the rotation settings", () => {
    for (const axis of AXES) {
      for (const rotationInDegrees of ROTATIONS_IN_90_DEGREE_STEPS) {
        for (const isMirrored of [false, true]) {
          const settings = { rotationInDegrees, isMirrored };
          expect(getRotationMatrixAroundAxis(axis, settings)).toStrictEqual(
            reference.getRotationMatrixAroundAxis(axis, settings),
          );
        }
      }
    }
  });

  it("getRotationMatrixAroundAxis should be within one ulp of the three.js implementation for arbitrary angles", () => {
    const random = createRandom(1);
    for (let i = 0; i < 3000; i++) {
      const axis = AXES[i % 3];
      const settings = { rotationInDegrees: random() * 720 - 360, isMirrored: random() < 0.5 };
      const actual = nestedToFlatMatrix(getRotationMatrixAroundAxis(axis, settings).matrix);
      const expected = nestedToFlatMatrix(
        reference.getRotationMatrixAroundAxis(axis, settings).matrix,
      );
      actual.forEach((value, index) => {
        expect(Math.abs(value - expected[index])).toBeLessThanOrEqual(Number.EPSILON);
      });
    }
  });

  it("fromCenterToOriginAsAffine and fromOriginToCenterAsAffine should equal the three.js implementation", () => {
    const random = createRandom(7);
    const boundingBoxes = [new BoundingBox({ min: [0, 0, 0], max: [0, 0, 0] })];
    for (let i = 0; i < 100; i++) {
      const min: Vector3 = [random() * 1000, random() * 1000, random() * 1000];
      boundingBoxes.push(
        new BoundingBox({ min, max: [min[0] + random() * 999, min[1] + 1, min[2] + 17] }),
      );
    }
    for (const bbox of boundingBoxes) {
      expect(fromCenterToOriginAsAffine(bbox)).toStrictEqual(
        reference.fromCenterToOriginAsAffine(bbox),
      );
      expect(fromOriginToCenterAsAffine(bbox)).toStrictEqual(
        reference.fromOriginToCenterAsAffine(bbox),
      );
    }
  });

  it("isTranslationOnly should decide like the three.js implementation", () => {
    for (const candidate of getCandidateMatrices()) {
      expect(isTranslationOnly(candidate), JSON.stringify(candidate.matrix)).toBe(
        reference.isTranslationOnly(candidate),
      );
    }
  });

  it("doAllLayersHaveTheSameRotation should decide like the three.js implementation", () => {
    const bbox = new BoundingBox({ min: [0, 0, 0], max: [100, 100, 100] });
    const validPattern = [
      reference.fromCenterToOriginAsAffine(bbox),
      reference.getRotationMatrixAroundAxis("x", { rotationInDegrees: 90, isMirrored: false }),
      reference.getRotationMatrixAroundAxis("y", { rotationInDegrees: 180, isMirrored: true }),
      reference.getRotationMatrixAroundAxis("z", { rotationInDegrees: 270, isMirrored: false }),
      reference.fromOriginToCenterAsAffine(bbox),
    ];
    expect(doAllLayersHaveTheSameRotation([createLayer(validPattern)])).toBe(true);

    let testedPatterns = 0;
    let validPatterns = 0;
    for (const candidate of getCandidateMatrices()) {
      // Replace one matrix at a time so that each check of the pattern is exercised.
      for (let index = 0; index < validPattern.length; index++) {
        const pattern = validPattern.map((transformation, i) =>
          i === index ? candidate : transformation,
        );
        const expected =
          reference.isTranslationOnly(pattern[0]) &&
          reference.isOnlyRotatedOrMirrored(pattern[1]) &&
          reference.isOnlyRotatedOrMirrored(pattern[2]) &&
          reference.isOnlyRotatedOrMirrored(pattern[3]) &&
          reference.isTranslationOnly(pattern[4]);
        expect(doAllLayersHaveTheSameRotation([createLayer(pattern)])).toBe(expected);
        testedPatterns++;
        if (expected) validPatterns++;
      }
    }
    // Make sure that both outcomes were covered.
    expect(validPatterns).toBeGreaterThan(0);
    expect(validPatterns).toBeLessThan(testedPatterns);
  });
});
