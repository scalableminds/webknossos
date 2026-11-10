import { M4x4, type Matrix4x4 } from "libs/mjs";
import { clamp, mod } from "libs/utils";
import isEqual from "lodash-es/isEqual";
import memoize from "lodash-es/memoize";
import type { AffineTransformation, APIDataLayer, CoordinateTransformation } from "types/api_types";
import { IdentityTransform, type NestedMatrix4, type Vector3 } from "viewer/constants";
import type BoundingBox from "viewer/model/bucket_data_handling/bounding_box";
import {
  chainTransforms,
  createAffineTransformFromMatrix,
  flatToNestedMatrix,
  type Transform,
} from "viewer/model/helpers/transformation_helpers";

// Helpers for rotating and mirroring a dataset as a whole, which is configured in the dataset
// settings. They are deliberately implemented without three.js, because the dataset settings
// are not part of the lazily loaded viewer and would otherwise pull three.js into the initially
// loaded code of all pages.

const IDENTITY_MATRIX = [
  [1, 0, 0, 0],
  [0, 1, 0, 0],
  [0, 0, 1, 0],
  [0, 0, 0, 1],
] as NestedMatrix4;

export const IDENTITY_TRANSFORM: CoordinateTransformation = {
  type: "affine",
  matrix: IDENTITY_MATRIX,
};

// cf. https://en.wikipedia.org/wiki/Rotation_matrix#In_three_dimensions
export const sinusLocationOfRotationInMatrix = {
  x: [2, 1],
  y: [0, 2],
  z: [1, 0],
};

export const cosineLocationOfRotationInMatrix = {
  x: [1, 1],
  y: [0, 0],
  z: [0, 0],
};

export const AXIS_TO_TRANSFORM_INDEX = {
  x: 1,
  y: 2,
  z: 3,
};

const axisPositionInMatrix = { x: 0, y: 1, z: 2 };

const AXIS_VECTORS: Record<"x" | "y" | "z", Vector3> = {
  x: [1, 0, 0],
  y: [0, 1, 0],
  z: [0, 0, 1],
};

export type RotationAndMirroringSettings = {
  rotationInDegrees: number;
  isMirrored: boolean;
};
// This function extracts the rotation in 90 degree steps and whether the axis is mirrored from the transformation matrix.
// The transformation matrix must only include a rotation around one of the main axis.
export function getRotationSettingsFromTransformationIn90DegreeSteps(
  transformation: CoordinateTransformation | undefined,
  axis: "x" | "y" | "z",
): RotationAndMirroringSettings {
  if (transformation && transformation.type !== "affine") {
    return { rotationInDegrees: 0, isMirrored: false };
  }
  const matrix = transformation ? transformation.matrix : IDENTITY_MATRIX;
  const isMirrored = matrix[axisPositionInMatrix[axis]][axisPositionInMatrix[axis]] < 0;
  const cosineLocation = cosineLocationOfRotationInMatrix[axis];
  const sinusLocation = sinusLocationOfRotationInMatrix[axis];
  const sinOfAngle = matrix[sinusLocation[0]][sinusLocation[1]];
  const cosOfAngle = matrix[cosineLocation[0]][cosineLocation[1]];
  const rotation =
    Math.abs(cosOfAngle) > 1e-6 // Avoid division by zero
      ? Math.atan2(sinOfAngle, cosOfAngle)
      : sinOfAngle > 0
        ? Math.PI / 2
        : -Math.PI / 2;
  const rotationInDegrees = rotation * (180 / Math.PI);
  // Round to multiple of 90 degrees and keep the result positive.
  const roundedRotation = mod(Math.round((rotationInDegrees + 360) / 90) * 90, 360);
  return { rotationInDegrees: roundedRotation, isMirrored };
}

// mjs matrices are column-major, whereas coordinate transformations are stored row-major.
function columnMajorToAffine(matrix: Matrix4x4): AffineTransformation {
  return { type: "affine", matrix: flatToNestedMatrix(M4x4.transpose(matrix)) };
}

export function fromCenterToOriginAsAffine(bbox: BoundingBox): AffineTransformation {
  const center = bbox.getCenter();
  return columnMajorToAffine(M4x4.makeTranslate3(-center[0], -center[1], -center[2]));
}

export function fromOriginToCenterAsAffine(bbox: BoundingBox): AffineTransformation {
  const center = bbox.getCenter();
  return columnMajorToAffine(M4x4.makeTranslate3(center[0], center[1], center[2]));
}

export function getRotationMatrixAroundAxis(
  axis: "x" | "y" | "z",
  rotationAndMirroringSettings: RotationAndMirroringSettings,
): AffineTransformation {
  const rotationInRadians = rotationAndMirroringSettings.rotationInDegrees * (Math.PI / 180);
  let rotationMatrix = M4x4.makeRotate(rotationInRadians, AXIS_VECTORS[axis]);
  if (rotationAndMirroringSettings.isMirrored) {
    const scale: Vector3 = [1, 1, 1];
    scale[axisPositionInMatrix[axis]] = -1;
    rotationMatrix = M4x4.mul(rotationMatrix, M4x4.makeScale3(...scale));
  }
  const matrixWithoutNearlyZeroValues = M4x4.transpose(rotationMatrix) // Column-major to row-major
    // Avoid nearly zero values due to floating point arithmetic inaccuracies.
    .map((value) => (Math.abs(value) < Number.EPSILON ? 0 : value)) as Matrix4x4;
  return { type: "affine", matrix: flatToNestedMatrix(matrixWithoutNearlyZeroValues) };
}

const EPSILON = 0.0001;

// The following two functions compute the scale and the rotation angle of an affine matrix
// exactly like three.js' Matrix4.decompose() and Quaternion.angleTo() do.
function getScale(m: NestedMatrix4): Vector3 {
  const getColumnLength = (column: number) =>
    Math.sqrt(
      m[0][column] * m[0][column] + m[1][column] * m[1][column] + m[2][column] * m[2][column],
    );
  // For affine matrices, this is the same as the determinant of the whole 4x4 matrix.
  const determinant =
    m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
    m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
    m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  const scaleX = getColumnLength(0);
  return [determinant < 0 ? -scaleX : scaleX, getColumnLength(1), getColumnLength(2)];
}

// Expects that the upper-left 3x3 part of the matrix is unscaled.
function getRotationAngle(m: NestedMatrix4): number {
  const [[m11, m12, m13], [m21, m22, m23], [m31, m32, m33]] = m;
  const trace = m11 + m22 + m33;
  // The w component of the quaternion as computed by three.js' Quaternion.setFromRotationMatrix().
  let w: number;
  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1.0);
    w = 0.25 / s;
  } else if (m11 > m22 && m11 > m33) {
    w = (m32 - m23) / (2.0 * Math.sqrt(1.0 + m11 - m22 - m33));
  } else if (m22 > m33) {
    w = (m13 - m31) / (2.0 * Math.sqrt(1.0 + m22 - m11 - m33));
  } else {
    w = (m21 - m12) / (2.0 * Math.sqrt(1.0 + m33 - m11 - m22));
  }
  // The angle to the identity quaternion.
  return 2 * Math.acos(Math.abs(clamp(-1, w, 1)));
}

export function isTranslationOnly(transformation?: AffineTransformation) {
  if (!transformation) {
    return false;
  }
  const { matrix } = transformation;
  const [scaleX, scaleY, scaleZ] = getScale(matrix);
  // Only if the scale is 1, the rotation part of the matrix is unscaled.
  return scaleX === 1 && scaleY === 1 && scaleZ === 1 && getRotationAngle(matrix) < EPSILON;
}

function isOnlyRotatedOrMirrored(transformation?: AffineTransformation) {
  if (!transformation) {
    return false;
  }
  const { matrix } = transformation;
  const [scaleX, scaleY, scaleZ] = getScale(matrix);
  const [translationX, translationY, translationZ] = [matrix[0][3], matrix[1][3], matrix[2][3]];
  const translationLength = Math.sqrt(
    translationX * translationX + translationY * translationY + translationZ * translationZ,
  );
  return (
    translationLength === 0 &&
    isEqual([Math.abs(scaleX), Math.abs(scaleY), Math.abs(scaleZ)], [1, 1, 1])
  );
}

function hasValidSettingsTransformationCount(dataLayers: Array<APIDataLayer>): boolean {
  return dataLayers.every((layer) => layer.coordinateTransformations?.length === 5);
}

function hasOnlySettingsAffineTransformations(dataLayers: Array<APIDataLayer>): boolean {
  return dataLayers.every((layer) =>
    layer.coordinateTransformations?.every((transformation) => transformation.type === "affine"),
  );
}

// The transformation array consists of 5 matrices:
// 1. Translation to coordinate system origin
// 2. Rotation around x-axis (potentially mirrored)
// 3. Rotation around y-axis (potentially mirrored)
// 4. Rotation around z-axis (potentially mirrored)
// 5. Translation back to original position
export const EXPECTED_SETTINGS_TRANSFORMATION_LENGTH = 5;

function hasValidSettingsTransformationPattern(
  transformations: CoordinateTransformation[],
): boolean {
  return (
    transformations.length === EXPECTED_SETTINGS_TRANSFORMATION_LENGTH &&
    isTranslationOnly(transformations[0] as AffineTransformation) &&
    isOnlyRotatedOrMirrored(transformations[1] as AffineTransformation) &&
    isOnlyRotatedOrMirrored(transformations[2] as AffineTransformation) &&
    isOnlyRotatedOrMirrored(transformations[3] as AffineTransformation) &&
    isTranslationOnly(transformations[4] as AffineTransformation)
  );
}

function _doAllLayersHaveTheSameRotation(dataLayers: Array<APIDataLayer>): boolean {
  if (dataLayers.length === 0) {
    // The dataset does not have any layers. Therefore no layers can be rotated.
    return false;
  }
  const firstDataLayerTransformations = dataLayers[0].coordinateTransformations;
  if (firstDataLayerTransformations == null || firstDataLayerTransformations.length === 0) {
    // No transformations in all layers compatible with setting a rotation for the whole dataset.
    return dataLayers.every(
      (layer) =>
        layer.coordinateTransformations == null || layer.coordinateTransformations.length === 0,
    );
  }
  // There should be a translation to the origin, one transformation for each axis and one translation back. => A total of 5 affine transformations.
  if (
    !hasValidSettingsTransformationCount(dataLayers) ||
    !hasOnlySettingsAffineTransformations(dataLayers)
  ) {
    return false;
  }

  if (!hasValidSettingsTransformationPattern(firstDataLayerTransformations)) {
    return false;
  }
  for (let i = 1; i < dataLayers.length; i++) {
    const transformations = dataLayers[i].coordinateTransformations;
    if (
      transformations == null ||
      !isEqual(transformations[0], firstDataLayerTransformations[0]) ||
      !isEqual(transformations[1], firstDataLayerTransformations[1]) ||
      !isEqual(transformations[2], firstDataLayerTransformations[2]) ||
      !isEqual(transformations[3], firstDataLayerTransformations[3]) ||
      !isEqual(transformations[4], firstDataLayerTransformations[4])
    ) {
      return false;
    }
  }
  return true;
}

export const doAllLayersHaveTheSameRotation = memoize(_doAllLayersHaveTheSameRotation);

export function settingsTransformationEqualsAffineIdentityTransform(
  transformations: CoordinateTransformation[],
): boolean {
  const hasValidTransformationCount =
    transformations.length === EXPECTED_SETTINGS_TRANSFORMATION_LENGTH;
  const hasOnlyAffineTransformations = transformations.every(
    (transformation) => transformation.type === "affine",
  );
  if (!hasValidTransformationCount || !hasOnlyAffineTransformations) {
    return false;
  }
  const resultingTransformation = transformations.reduce(
    (accTransformation, currentTransformation) =>
      chainTransforms(
        accTransformation,
        createAffineTransformFromMatrix(currentTransformation.matrix),
      ),
    IdentityTransform as Transform,
  );
  return isEqual(resultingTransformation, IdentityTransform);
}
