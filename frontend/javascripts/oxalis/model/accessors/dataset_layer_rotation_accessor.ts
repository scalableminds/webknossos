import { M4x4, type Matrix4x4 } from "libs/mjs";
import { Identity4x4, IdentityTransform, type NestedMatrix4, type Vector4 } from "oxalis/constants";
import type { OxalisState } from "oxalis/store";
import * as THREE from "three";
import type {
  AffineTransformation,
  APIDataLayer,
  APIDataset,
  APISkeletonLayer,
  CoordinateTransformation,
} from "types/api_flow_types";
import { mod } from "libs/utils";
import MultiKeyMap from "libs/multi_key_map";
import _ from "lodash";
import memoizeOne from "memoize-one";
import {
  createAffineTransformFromMatrix,
  createThinPlateSplineTransform,
  chainTransforms,
  invertTransform,
  transformPointUnscaled,
  nestedToFlatMatrix,
  type Transform,
} from "../helpers/transformation_helpers";
import { getLayerByName } from "./dataset_accessor";
import type BoundingBox from "../bucket_data_handling/bounding_box";

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

// This function extracts the rotation in 90 degree steps a the transformation matrix.
// The transformation matrix must only include a rotation around one of the main axis.
export function getRotationFromTransformationIn90DegreeSteps(
  transformation: CoordinateTransformation | undefined,
  axis: "x" | "y" | "z",
) {
  if (transformation && transformation.type !== "affine") {
    return 0;
  }
  const matrix = transformation ? transformation.matrix : IDENTITY_MATRIX;
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
  return roundedRotation;
}

export function fromCenterToOrigin(bbox: BoundingBox): AffineTransformation {
  const center = bbox.getCenter();
  const translationMatrix = new THREE.Matrix4()
    .makeTranslation(-center[0], -center[1], -center[2])
    .transpose(); // Column-major to row-major
  return { type: "affine", matrix: flatToNestedMatrix(translationMatrix.toArray()) };
}

export function fromOriginToCenter(bbox: BoundingBox): AffineTransformation {
  const center = bbox.getCenter();
  const translationMatrix = new THREE.Matrix4()
    .makeTranslation(center[0], center[1], center[2])
    .transpose(); // Column-major to row-major
  return { type: "affine", matrix: flatToNestedMatrix(translationMatrix.toArray()) };
}
export function getRotationMatrixAroundAxis(
  axis: "x" | "y" | "z",
  angleInRadians: number,
): AffineTransformation {
  const euler = new THREE.Euler();
  euler[axis] = angleInRadians;
  const rotationMatrix = new THREE.Matrix4().makeRotationFromEuler(euler).transpose(); // Column-major to row-major
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

  const transforms = coordinateTransformations.map((coordTransformation) => {
    const { type } = coordTransformation;
    if (type === "affine") {
      const nestedMatrix = coordTransformation.matrix;
      return createAffineTransformFromMatrix(nestedMatrix);
    } else if (type === "thin_plate_spline") {
      const { source, target } = coordTransformation.correspondences;

      return createThinPlateSplineTransform(source, target, dataset.dataSource.scale.factor);
    }

    console.error(
      "Data layer has defined a coordinate transform that is not affine or thin_plate_spline. This is currently not supported and ignored",
    );
    return IdentityTransform;
  });
  return transforms.reduce(chainTransforms, IdentityTransform);
}

export const getOriginalTransformsForLayerOrNull = memoizeWithTwoKeys(
  _getOriginalTransformsForLayerOrNull,
);

export function isLayerWithoutTransformationConfigSupport(layer: APIDataLayer | APISkeletonLayer) {
  return (
    layer.category === "skeleton" ||
    (layer.category === "segmentation" && "tracingId" in layer && !layer.fallbackLayer)
  );
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
    return layerTransforms;
  }

  // Apply the inverse of the layer that should be rendered natively
  // to the current layer's transforms.
  const nativeLayer = getLayerByName(dataset, nativelyRenderedLayerName, true);
  const transformsOfNativeLayer = getOriginalTransformsForLayerOrNull(dataset, nativeLayer);

  if (transformsOfNativeLayer == null) {
    // The inverse of no transforms, are no transforms. Leave the layer
    // transforms untouched.
    return layerTransforms;
  }

  const inverseNativeTransforms = invertTransform(transformsOfNativeLayer);
  return chainTransforms(layerTransforms, inverseNativeTransforms);
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

export function isIdentityTransform(transform: Transform) {
  return transform.type === "affine" && _.isEqual(transform.affineMatrix, Identity4x4);
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
    return someLayersTransformsMaybe;
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

  return invertTransform(transformsOfNativeLayer);
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
  state: OxalisState,
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
export const invertAndTranspose = _.memoize((mat: Matrix4x4) => {
  return M4x4.transpose(M4x4.inverse(mat));
});

const translation = new THREE.Vector3();
const scale = new THREE.Vector3();
const quaternion = new THREE.Quaternion();
const IDENTITY_QUATERNION = new THREE.Quaternion();

const NON_SCALED_VECTOR = new THREE.Vector3(1, 1, 1);

function isTranslationOnly(transformation?: AffineTransformation) {
  if (!transformation) {
    return false;
  }
  const threeMatrix = new THREE.Matrix4()
    .fromArray(nestedToFlatMatrix(transformation.matrix))
    .transpose();
  threeMatrix.decompose(translation, quaternion, scale);
  return scale.equals(NON_SCALED_VECTOR) && quaternion.equals(IDENTITY_QUATERNION);
}

function isRotationOnly(transformation?: AffineTransformation) {
  if (!transformation) {
    return false;
  }
  const threeMatrix = new THREE.Matrix4()
    .fromArray(nestedToFlatMatrix(transformation.matrix))
    .transpose();
  threeMatrix.decompose(translation, quaternion, scale);
  return translation.length() === 0 && scale.equals(NON_SCALED_VECTOR);
}

function hasValidTransformationCount(dataLayers: Array<APIDataLayer>): boolean {
  return dataLayers.every((layer) => layer.coordinateTransformations?.length === 5);
}

function hasOnlyAffineTransformations(dataLayers: Array<APIDataLayer>): boolean {
  return dataLayers.every((layer) =>
    layer.coordinateTransformations?.every((transformation) => transformation.type === "affine"),
  );
}

function hasValidTransformationPattern(transformations: CoordinateTransformation[]): boolean {
  return (
    isTranslationOnly(transformations[0] as AffineTransformation) &&
    isRotationOnly(transformations[1] as AffineTransformation) &&
    isRotationOnly(transformations[2] as AffineTransformation) &&
    isRotationOnly(transformations[3] as AffineTransformation) &&
    isTranslationOnly(transformations[4] as AffineTransformation)
  );
}

function _doAllLayersHaveTheSameRotation(dataLayers: Array<APIDataLayer>): boolean {
  const firstDataLayerTransformations = dataLayers[0]?.coordinateTransformations;
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
      !_.isEqual(transformations[0], firstDataLayerTransformations[0]) ||
      !_.isEqual(transformations[1], firstDataLayerTransformations[1]) ||
      !_.isEqual(transformations[2], firstDataLayerTransformations[2]) ||
      !_.isEqual(transformations[3], firstDataLayerTransformations[3]) ||
      !_.isEqual(transformations[4], firstDataLayerTransformations[4])
    ) {
      return false;
    }
  }
  return true;
}

export const doAllLayersHaveTheSameRotation = _.memoize(_doAllLayersHaveTheSameRotation);
