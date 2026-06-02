import { M4x4, type Matrix4x4 } from "libs/mjs";
import MultiKeyMap from "libs/multi_key_map";
import { mod } from "libs/utils";
import isEqual from "lodash-es/isEqual";
import memoize from "lodash-es/memoize";
import memoizeOne from "memoize-one";
import { Euler, Matrix4, Quaternion, Vector3 as ThreeVector3 } from "three";
import type {
  AffineTransformation,
  APIDataLayer,
  APIDataset,
  APISkeletonLayer,
  CoordinateTransformation,
} from "types/api_types";
import {
  Identity4x4,
  IdentityTransform,
  type NestedMatrix4,
  type Vector3,
  type Vector4,
} from "viewer/constants";
import type { WebknossosState } from "viewer/store";
import type BoundingBox from "../bucket_data_handling/bounding_box";
import {
  chainTransforms,
  createAffineTransformFromMatrix,
  createThinPlateSplineTransform,
  invertTransform,
  nestedToFlatMatrix,
  type Transform,
  transformPointUnscaled,
} from "../helpers/transformation_helpers";
import { type getDatasetBoundingBox, getLayerByName } from "./dataset_accessor";

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
const sinusLocationOfRotationInMatrix = {
  x: [2, 1],
  y: [0, 2],
  z: [1, 0],
};

const cosineLocationOfRotationInMatrix = {
  x: [1, 1],
  y: [0, 0],
  z: [0, 0],
};

export const AXIS_TO_TRANSFORM_INDEX = {
  x: 1,
  y: 2,
  z: 3,
};

export function flatToNestedMatrix(matrix: Matrix4x4): NestedMatrix4 {
  return [
    matrix.slice(0, 4) as Vector4,
    matrix.slice(4, 8) as Vector4,
    matrix.slice(8, 12) as Vector4,
    matrix.slice(12, 16) as Vector4,
  ];
}

const axisPositionInMatrix = { x: 0, y: 1, z: 2 };

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

export function threeMatrix4ToAffine(m: Matrix4): AffineTransformation {
  return { type: "affine", matrix: flatToNestedMatrix(m.clone().transpose().toArray()) };
}

export function fromCenterToOrigin(bbox: BoundingBox): Matrix4 {
  const center = bbox.getCenter();
  return new Matrix4().makeTranslation(-center[0], -center[1], -center[2]);
}

export function fromOriginToCenter(bbox: BoundingBox): Matrix4 {
  const center = bbox.getCenter();
  return new Matrix4().makeTranslation(center[0], center[1], center[2]);
}

export function fromCenterToOriginAsAffine(bbox: BoundingBox): AffineTransformation {
  return threeMatrix4ToAffine(fromCenterToOrigin(bbox));
}

export function fromOriginToCenterAsAffine(bbox: BoundingBox): AffineTransformation {
  return threeMatrix4ToAffine(fromOriginToCenter(bbox));
}

export function getRotationMatrixAroundAxis(
  axis: "x" | "y" | "z",
  rotationAndMirroringSettings: RotationAndMirroringSettings,
): AffineTransformation {
  const euler = new Euler();
  const rotationInRadians = rotationAndMirroringSettings.rotationInDegrees * (Math.PI / 180);
  euler[axis] = rotationInRadians;
  let rotationMatrix = new Matrix4().makeRotationFromEuler(euler);
  if (rotationAndMirroringSettings.isMirrored) {
    const scaleVector = new ThreeVector3(1, 1, 1);
    scaleVector[axis] = -1;
    rotationMatrix = rotationMatrix.multiply(
      new Matrix4().makeScale(scaleVector.x, scaleVector.y, scaleVector.z),
    );
  }
  rotationMatrix = rotationMatrix.transpose(); // Column-major to row-major
  const matrixWithoutNearlyZeroValues = rotationMatrix
    .toArray()
    // Avoid nearly zero values due to floating point arithmetic inaccuracies.
    .map((value) => (Math.abs(value) < Number.EPSILON ? 0 : value)) as Matrix4x4;
  return { type: "affine", matrix: flatToNestedMatrix(matrixWithoutNearlyZeroValues) };
}

function memoizeWithThreeKeys<A, B, C, T>(fn: (a: A, b: B, c: C) => T) {
  const map = new MultiKeyMap<A | B | C, T, [A, B, C]>();
  return (a: A, b: B, c: C): T => {
    let res = map.get([a, b, c]);
    if (res === undefined) {
      res = fn(a, b, c);
      map.set([a, b, c], res);
    }
    return res;
  };
}

function memoizeWithTwoKeys<A, B, T>(fn: (a: A, b: B) => T) {
  const map = new MultiKeyMap<A | B, T, [A, B]>();
  return (a: A, b: B): T => {
    let res = map.get([a, b]);
    if (res === undefined) {
      res = fn(a, b);
      map.set([a, b], res);
    }
    return res;
  };
}

// Returns the transforms (if they exist) for a layer as
// they are defined in the dataset properties.
function _getOriginalTransformsForLayerOrNull(
  dataset: APIDataset,
  layer: APIDataLayer,
): Transform | null {
  const coordinateTransformations = layer.coordinateTransformations;
  if (!coordinateTransformations || coordinateTransformations.length === 0) {
    return null;
  }

  return combineCoordinateTransformations(
    coordinateTransformations,
    dataset.dataSource.scale.factor,
  );
}

const getOriginalTransformsForLayerOrNull = memoizeWithTwoKeys(
  _getOriginalTransformsForLayerOrNull,
);

export function combineCoordinateTransformations(
  coordinateTransformations: CoordinateTransformation[],
  scaleFactor: Vector3,
): Transform {
  const transforms = coordinateTransformations.map((coordTransformation) => {
    const { type } = coordTransformation;
    if (type === "affine") {
      const nestedMatrix = coordTransformation.matrix;
      return createAffineTransformFromMatrix(nestedMatrix);
    } else if (type === "thin_plate_spline") {
      const { source, target } = coordTransformation.correspondences;

      return createThinPlateSplineTransform(source, target, scaleFactor);
    }

    console.error(
      "Data layer has defined a coordinate transform that is not affine or thin_plate_spline. This is currently not supported and ignored",
    );
    return IdentityTransform;
  });
  return transforms.reduce(chainTransforms, IdentityTransform);
}

export function isLayerWithoutTransformationConfigSupport(layer: APIDataLayer | APISkeletonLayer) {
  return (
    layer.category === "skeleton" ||
    (layer.category === "segmentation" && "tracingId" in layer && !layer.fallbackLayer)
  );
}

function toIdentityTransformMaybe(transform: Transform | null): Transform | null {
  return transform && equalsIdentityTransform(transform) ? IdentityTransform : transform;
}

function _getTransformsForLayerOrNull(
  dataset: APIDataset,
  layer: APIDataLayer | APISkeletonLayer,
  nativelyRenderedLayerName: string | null,
): Transform | null {
  if (isLayerWithoutTransformationConfigSupport(layer)) {
    return getTransformsForLayerThatDoesNotSupportTransformationConfigOrNull(
      dataset,
      nativelyRenderedLayerName,
    );
  }
  if (layer.name === nativelyRenderedLayerName) {
    // This layer should be rendered without any transforms.
    return null;
  }
  const layerTransforms = getOriginalTransformsForLayerOrNull(dataset, layer as APIDataLayer);
  if (nativelyRenderedLayerName == null) {
    // No layer is requested to be rendered natively. -> We can use the layer's transforms as is.
    return toIdentityTransformMaybe(layerTransforms);
  }

  // Apply the inverse of the layer that should be rendered natively
  // to the current layer's transforms.
  const nativeLayer = getLayerByName(dataset, nativelyRenderedLayerName, true);
  const transformsOfNativeLayer = getOriginalTransformsForLayerOrNull(dataset, nativeLayer);

  if (transformsOfNativeLayer == null) {
    // The inverse of no transforms, are no transforms. Leave the layer
    // transforms untouched.
    return toIdentityTransformMaybe(layerTransforms);
  }

  const inverseNativeTransforms = invertTransform(transformsOfNativeLayer);
  return toIdentityTransformMaybe(chainTransforms(layerTransforms, inverseNativeTransforms));
}

export const getTransformsForLayerOrNull = memoizeWithThreeKeys(_getTransformsForLayerOrNull);
export function getTransformsForLayer(
  dataset: APIDataset,
  layer: APIDataLayer | APISkeletonLayer,
  nativelyRenderedLayerName: string | null,
): Transform {
  return (
    getTransformsForLayerOrNull(dataset, layer, nativelyRenderedLayerName) || IdentityTransform
  );
}

function equalsIdentityTransform(transform: Transform) {
  return transform.type === "affine" && isEqual(transform.affineMatrix, Identity4x4);
}

function _getTransformsForLayerThatDoesNotSupportTransformationConfigOrNull(
  dataset: APIDataset,
  nativelyRenderedLayerName: string | null,
): Transform | null {
  const layers = dataset.dataSource.dataLayers;
  const allLayersSameRotation = doAllLayersHaveTheSameRotation(layers);
  if (nativelyRenderedLayerName == null) {
    // No layer is requested to be rendered natively. -> We can use each layer's transforms as is.
    if (!allLayersSameRotation) {
      // If the dataset's layers do not have a consistent transformation (which only rotates the dataset),
      // we cannot guess what transformation should be applied to the layer.
      // As skeleton layer and volume layer without fallback don't have a transforms property currently.
      return null;
    }

    // The skeleton layer / volume layer without fallback needs transformed just like the other layers.
    // Thus, we simply use the first usable layer which supports transforms.
    const usableReferenceLayer = layers.find(
      (layer) => !isLayerWithoutTransformationConfigSupport(layer),
    );
    const someLayersTransformsMaybe = usableReferenceLayer
      ? getTransformsForLayerOrNull(dataset, usableReferenceLayer, nativelyRenderedLayerName)
      : null;
    return toIdentityTransformMaybe(someLayersTransformsMaybe);
  } else if (nativelyRenderedLayerName != null && allLayersSameRotation) {
    // If all layers have the same transformations and at least one is rendered natively, this means that all layer should be rendered natively.
    return null;
  }

  // Compute the inverse of the layer that should be rendered natively.
  const nativeLayer = getLayerByName(dataset, nativelyRenderedLayerName, true);
  const transformsOfNativeLayer = getOriginalTransformsForLayerOrNull(dataset, nativeLayer);

  if (transformsOfNativeLayer == null) {
    // The inverse of no transforms, are no transforms.
    return null;
  }

  return toIdentityTransformMaybe(invertTransform(transformsOfNativeLayer));
}

export const getTransformsForLayerThatDoesNotSupportTransformationConfigOrNull = memoizeOne(
  _getTransformsForLayerThatDoesNotSupportTransformationConfigOrNull,
);

export function getTransformsForSkeletonLayer(
  dataset: APIDataset,
  nativelyRenderedLayerName: string | null,
): Transform {
  return (
    getTransformsForLayerThatDoesNotSupportTransformationConfigOrNull(
      dataset,
      nativelyRenderedLayerName,
    ) || IdentityTransform
  );
}

function _getTransformsPerLayer(
  dataset: APIDataset,
  nativelyRenderedLayerName: string | null,
): Record<string, Transform> {
  const transformsPerLayer: Record<string, Transform> = {};
  const layers = dataset.dataSource.dataLayers;
  for (const layer of layers) {
    const transforms = getTransformsForLayer(dataset, layer, nativelyRenderedLayerName);
    transformsPerLayer[layer.name] = transforms;
  }

  return transformsPerLayer;
}

export const getTransformsPerLayer = memoizeWithTwoKeys(_getTransformsPerLayer);

export function getInverseSegmentationTransformer(
  state: WebknossosState,
  segmentationLayerName: string,
) {
  const { dataset } = state;
  const { nativelyRenderedLayerName } = state.datasetConfiguration;
  const layer = getLayerByName(dataset, segmentationLayerName);
  const segmentationTransforms = getTransformsForLayer(dataset, layer, nativelyRenderedLayerName);
  return transformPointUnscaled(invertTransform(segmentationTransforms));
}

export const hasDatasetTransforms = memoizeOne((dataset: APIDataset) => {
  const layers = dataset.dataSource.dataLayers;
  return layers.some((layer) => getOriginalTransformsForLayerOrNull(dataset, layer) != null);
});

// Transposition is often needed so that the matrix has the right format
// for matrix operations (e.g., on the GPU; but not for ThreeJS).
// Inversion is needed when the position of an "output voxel" (e.g., during
// rendering in the fragment shader) needs to be mapped to its original
// data position (i.e., how it's stored without the transformation).
// Without the inversion, the matrix maps from stored position to the position
// where it should be rendered.
export const invertAndTranspose = memoize((mat: Matrix4x4) => {
  return M4x4.transpose(M4x4.inverse(mat));
});

const translation = new ThreeVector3();
const scale = new ThreeVector3();
const quaternion = new Quaternion();
const IDENTITY_QUATERNION = new Quaternion();

const NON_SCALED_VECTOR = new ThreeVector3(1, 1, 1);
const EPSILON = 0.0001;

function isTranslationOnly(transformation?: AffineTransformation) {
  if (!transformation) {
    return false;
  }
  const threeMatrix = new Matrix4()
    .fromArray(nestedToFlatMatrix(transformation.matrix))
    .transpose();
  threeMatrix.decompose(translation, quaternion, scale);
  return scale.equals(NON_SCALED_VECTOR) && quaternion.angleTo(IDENTITY_QUATERNION) < EPSILON;
}

function isOnlyRotatedOrMirrored(transformation?: AffineTransformation) {
  if (!transformation) {
    return false;
  }
  const threeMatrix = new Matrix4()
    .fromArray(nestedToFlatMatrix(transformation.matrix))
    .transpose();
  threeMatrix.decompose(translation, quaternion, scale);
  return (
    translation.length() === 0 &&
    isEqual([Math.abs(scale.x), Math.abs(scale.y), Math.abs(scale.z)], [1, 1, 1])
  );
}
function isRotationOnly(transformation?: AffineTransformation) {
  if (!transformation) {
    return false;
  }
  const threeMatrix = new Matrix4()
    .fromArray(nestedToFlatMatrix(transformation.matrix))
    .transpose();
  threeMatrix.decompose(translation, quaternion, scale);
  return translation.length() <= EPSILON && scale.distanceToSquared(NON_SCALED_VECTOR) < EPSILON;
}

function isScaleOnly(transformation?: AffineTransformation) {
  if (!transformation) {
    return false;
  }
  // decompose() cannot handle negative scales (det < 0 causes improper rotation extraction),
  // so inspect the matrix directly: a pure scale matrix is diagonal with no translation.
  const m = transformation.matrix;
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      if (i !== j && Math.abs(m[i][j]) > EPSILON) return false;
    }
    if (Math.abs(m[i][3]) > EPSILON) return false; // Checks projection component to be 0.
  }
  return (
    Math.abs(m[3][0]) <= EPSILON && // checks for translation
    Math.abs(m[3][1]) <= EPSILON && // checks for translation
    Math.abs(m[3][2]) <= EPSILON && // checks for translation
    Math.abs(m[3][3] - 1) <= EPSILON // checks w component
  );
}

function hasValidTransformationCount(dataLayers: Array<APIDataLayer>): boolean {
  return dataLayers.every((layer) => layer.coordinateTransformations?.length === 5);
}

function hasOnlyAffineTransformations(dataLayers: Array<APIDataLayer>): boolean {
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
export const EXPECTED_TRANSFORMATION_LENGTH = 5;

function hasValidTransformationPattern(transformations: CoordinateTransformation[]): boolean {
  return (
    transformations.length === EXPECTED_TRANSFORMATION_LENGTH &&
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
  if (!hasValidTransformationCount(dataLayers) || !hasOnlyAffineTransformations(dataLayers)) {
    return false;
  }

  if (!hasValidTransformationPattern(firstDataLayerTransformations)) {
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

export function transformationEqualsAffineIdentityTransform(
  transformations: CoordinateTransformation[],
): boolean {
  const hasValidTransformationCount = transformations.length === EXPECTED_TRANSFORMATION_LENGTH;
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

export function globalToLayerTransformedPosition(
  globalPos: Vector3,
  layerName: string,
  layerCategory: APIDataLayer["category"] | "skeleton",
  state: WebknossosState,
): Vector3 {
  const layerDescriptor =
    layerCategory !== "skeleton"
      ? getLayerByName(state.dataset, layerName, true)
      : ({ name: "skeleton", category: "skeleton" } as APISkeletonLayer);
  const layerTransforms = getTransformsForLayerOrNull(
    state.dataset,
    layerDescriptor,
    state.datasetConfiguration.nativelyRenderedLayerName,
  );
  if (layerTransforms) {
    return transformPointUnscaled(invertTransform(layerTransforms))(globalPos);
  }
  return globalPos;
}

export function layerToGlobalTransformedPosition(
  layerPos: Vector3,
  layerName: string,
  layerCategory: APIDataLayer["category"] | "skeleton",
  state: WebknossosState,
): Vector3 {
  const layerDescriptor =
    layerCategory !== "skeleton"
      ? getLayerByName(state.dataset, layerName, true)
      : ({ name: "skeleton", category: "skeleton" } as APISkeletonLayer);
  const layerTransforms = getTransformsForLayerOrNull(
    state.dataset,
    layerDescriptor,
    state.datasetConfiguration.nativelyRenderedLayerName,
  );
  if (layerTransforms) {
    return transformPointUnscaled(layerTransforms)(layerPos);
  }
  return layerPos;
}

// The live SRT transform format uses exactly 7 affine matrices in this order:
// [0]  dataset center→origin translation, [1] scale, [2] rotX, [3] rotY, [4] rotZ,
// [5] user translation, [6] origin→center dataset translation.
// They are stored separately to keep the extracted value consistent between reloads.
// Else e.g. some rotations might be shown differently as euler angles are not deterministic.
export const LIVE_TRANSFORM_LENGTH = 7;
export type SRTValues = {
  scale: [number, number, number];
  rotation: [number, number, number];
  translation: [number, number, number];
};

export const DEFAULT_SRT: SRTValues = {
  scale: [1, 1, 1],
  rotation: [0, 0, 0],
  translation: [0, 0, 0],
};

// Returns true when the transform list is in a format editable by the live SRT editor:
// null/empty (no transforms) or exactly the 7-affine pattern: translation, scale,
// rotX, rotY, rotZ, translation, translation.
export function isLiveTransformCompatible(
  transforms: CoordinateTransformation[] | null | undefined,
): boolean {
  if (transforms == null || transforms.length === 0) return true;
  if (transforms.length !== LIVE_TRANSFORM_LENGTH) return false;
  if (!transforms.every((t) => t.type === "affine")) return false;
  const t = transforms as AffineTransformation[];
  return (
    isTranslationOnly(t[0]) &&
    isScaleOnly(t[1]) &&
    isRotationOnly(t[2]) &&
    isRotationOnly(t[3]) &&
    isRotationOnly(t[4]) &&
    isTranslationOnly(t[5]) &&
    isTranslationOnly(t[6])
  );
}

// Row-major scale matrix: diagonal [sx, sy, sz, 1]
export function makeScaleMatrix(sx: number, sy: number, sz: number): AffineTransformation {
  const m = new Matrix4().makeScale(sx, sy, sz).transpose(); // column-major to row-major
  return { type: "affine", matrix: flatToNestedMatrix(m.toArray()) };
}

// Row-major translation matrix: last column = [tx, ty, tz]
export function makeTranslationMatrix(tx: number, ty: number, tz: number): AffineTransformation {
  const m = new Matrix4().makeTranslation(tx, ty, tz).transpose(); // column-major to row-major
  return { type: "affine", matrix: flatToNestedMatrix(m.toArray()) };
}

// Extract [sx, sy, sz] from the diagonal of a scale matrix.
export function extractScaleFromMatrix(t: AffineTransformation): [number, number, number] {
  return [t.matrix[0][0], t.matrix[1][1], t.matrix[2][2]];
}

// Extract [tx, ty, tz] from the last column of a translation matrix.
export function extractTranslationFromMatrix(t: AffineTransformation): [number, number, number] {
  return [t.matrix[0][3], t.matrix[1][3], t.matrix[2][3]];
}

// Extract the Euler angle in degrees from a single-axis rotation matrix
// (stored in row-major format, no 90° rounding).
export function extractEulerAngleDegreesFromMatrix(
  t: AffineTransformation,
  axis: "x" | "y" | "z",
): number {
  const sinLoc = sinusLocationOfRotationInMatrix[axis];
  const cosLoc = cosineLocationOfRotationInMatrix[axis];
  const sinVal = t.matrix[sinLoc[0]][sinLoc[1]];
  const cosVal = t.matrix[cosLoc[0]][cosLoc[1]];
  const radians = Math.atan2(sinVal, cosVal);
  return ((radians * 180) / Math.PI + 360) % 360;
}

// Extracts the SRTValues (scale, rotation, translation) from a 7 matrix coordinate transformation of a layer.
// Make sure this is only called with a compatible CoordinateTransformations.
export function extractSRTFromTransforms(transforms: CoordinateTransformation[]): SRTValues {
  if (transforms.length !== LIVE_TRANSFORM_LENGTH) return DEFAULT_SRT;
  return {
    scale: extractScaleFromMatrix(transforms[1] as AffineTransformation),
    rotation: [
      extractEulerAngleDegreesFromMatrix(transforms[2] as AffineTransformation, "x"),
      extractEulerAngleDegreesFromMatrix(transforms[3] as AffineTransformation, "y"),
      extractEulerAngleDegreesFromMatrix(transforms[4] as AffineTransformation, "z"),
    ],
    translation: extractTranslationFromMatrix(transforms[5] as AffineTransformation),
  };
}

function nestedToThreeMatrix(t: AffineTransformation): Matrix4 {
  const m = t.matrix;
  return new Matrix4().set(
    m[0][0],
    m[0][1],
    m[0][2],
    m[0][3],
    m[1][0],
    m[1][1],
    m[1][2],
    m[1][3],
    m[2][0],
    m[2][1],
    m[2][2],
    m[2][3],
    m[3][0],
    m[3][1],
    m[3][2],
    m[3][3],
  );
}

// Compose the existing layer transforms with a new affine (applied on top) and
// return the result in the 7-affine SRT format.  Non-affine transforms (e.g. TPS)
// are skipped; if there are no existing transforms the new affine is decomposed
// directly.
export function applyAffineOnTopOfTransforms(
  existingTransforms: CoordinateTransformation[],
  landmarkAffineFlat: Matrix4x4,
  datasetBbox: ReturnType<typeof getDatasetBoundingBox>,
): CoordinateTransformation[] {
  const landmarkMatrix = new Matrix4().set(
    landmarkAffineFlat[0],
    landmarkAffineFlat[1],
    landmarkAffineFlat[2],
    landmarkAffineFlat[3],
    landmarkAffineFlat[4],
    landmarkAffineFlat[5],
    landmarkAffineFlat[6],
    landmarkAffineFlat[7],
    landmarkAffineFlat[8],
    landmarkAffineFlat[9],
    landmarkAffineFlat[10],
    landmarkAffineFlat[11],
    landmarkAffineFlat[12],
    landmarkAffineFlat[13],
    landmarkAffineFlat[14],
    landmarkAffineFlat[15],
  );

  if (existingTransforms.length > 0) {
    // Compose all existing affine transforms: result = T[n] * ... * T[0]
    // so that T[0] is applied first to any point.
    const existingMatrix = new Matrix4();
    for (const t of existingTransforms) {
      if (t.type === "affine") {
        existingMatrix.premultiply(nestedToThreeMatrix(t));
      }
    }
    // Apply landmark on top: combined = landmark * existing
    landmarkMatrix.multiply(existingMatrix);
  }

  // Three.js Matrix4.elements is column-major; convert back to row-major flat.
  const e = landmarkMatrix.elements;
  const combinedFlat: Matrix4x4 = [
    e[0],
    e[4],
    e[8],
    e[12],
    e[1],
    e[5],
    e[9],
    e[13],
    e[2],
    e[6],
    e[10],
    e[14],
    e[3],
    e[7],
    e[11],
    e[15],
  ];

  return decomposeAffineToSRT(combinedFlat, datasetBbox);
}

export function decomposeAffineToSRT(
  affineFlat: Matrix4x4,
  datasetBboxArg: ReturnType<typeof getDatasetBoundingBox>,
): CoordinateTransformation[] {
  const A = new Matrix4().set(
    affineFlat[0],
    affineFlat[1],
    affineFlat[2],
    affineFlat[3],
    affineFlat[4],
    affineFlat[5],
    affineFlat[6],
    affineFlat[7],
    affineFlat[8],
    affineFlat[9],
    affineFlat[10],
    affineFlat[11],
    affineFlat[12],
    affineFlat[13],
    affineFlat[14],
    affineFlat[15],
  );

  // Strip center matrices to isolate the inner SRT part
  const T0 = fromCenterToOrigin(datasetBboxArg);
  const T6 = fromOriginToCenter(datasetBboxArg);
  const inner = new Matrix4()
    .copy(T6)
    .invert()
    .multiply(A)
    .multiply(new Matrix4().copy(T0).invert());

  const position = new ThreeVector3();
  const quaternion = new Quaternion();
  const scale = new ThreeVector3();
  inner.decompose(position, quaternion, scale);

  const euler = new Euler().setFromQuaternion(quaternion, "XYZ");
  const rotDeg: [number, number, number] = [
    (euler.x * 180) / Math.PI,
    (euler.y * 180) / Math.PI,
    (euler.z * 180) / Math.PI,
  ];
  const scaleArr: [number, number, number] = [scale.x, scale.y, scale.z];
  const transArr: [number, number, number] = [position.x, position.y, position.z];

  // Always return the SRT-decomposed form so the result stays editable in the
  // layer transform popover (isLiveTransformCompatible requires exactly 7 affines).
  // For transforms with shear this is the closest representable approximation.
  return buildLiveTransforms(scaleArr, rotDeg, transArr, datasetBboxArg);
}

// Build the 7-matrix SRT transform array for a layer.
// Order: center→origin, scale, rotX, rotY, rotZ, translation, origin→center
export function buildLiveTransforms(
  scale: [number, number, number],
  rotation: [number, number, number],
  translation: [number, number, number],
  datasetBbox: BoundingBox,
): AffineTransformation[] {
  return [
    fromCenterToOriginAsAffine(datasetBbox),
    makeScaleMatrix(...scale),
    getRotationMatrixAroundAxis("x", { rotationInDegrees: rotation[0], isMirrored: false }),
    getRotationMatrixAroundAxis("y", { rotationInDegrees: rotation[1], isMirrored: false }),
    getRotationMatrixAroundAxis("z", { rotationInDegrees: rotation[2], isMirrored: false }),
    makeTranslationMatrix(...translation),
    fromOriginToCenterAsAffine(datasetBbox),
  ];
}
