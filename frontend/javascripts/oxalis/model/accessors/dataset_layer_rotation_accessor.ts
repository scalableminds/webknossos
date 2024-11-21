import { M4x4, type Matrix4x4, V3 } from "libs/mjs";
import { IdentityTransform, type NestedMatrix4, type Vector4 } from "oxalis/constants";
import type { BoundingBoxObject, OxalisState } from "oxalis/store";
import THREE from "three";
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
  Transform,
} from "../helpers/transformation_helpers";
import { getLayerByName } from "./dataset_accessor";

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

export function getRotationFromTransformation(
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
    Math.abs(cosOfAngle) > 1e-6
      ? Math.atan2(sinOfAngle, cosOfAngle)
      : sinOfAngle > 0
        ? Math.PI / 2
        : -Math.PI / 2;
  const rotationInDegrees = rotation * (180 / Math.PI);
  // Round to multiple of 90 degrees and keep the result positive.
  const roundedRotation = mod(Math.round((rotationInDegrees + 360) / 90) * 90, 360);
  return roundedRotation;
}

export function getTranslationToOrigin(bbox: BoundingBoxObject): CoordinateTransformation {
  const center = V3.add(bbox.topLeft, V3.scale([bbox.width, bbox.height, bbox.depth], 0.5));
  const translationMatrix = new THREE.Matrix4()
    .makeTranslation(-center[0], -center[1], -center[2])
    .transpose();
  return { type: "affine", matrix: flatToNestedMatrix(translationMatrix.toArray()) };
}

export function getTranslationBackToOriginalPosition(
  bbox: BoundingBoxObject,
): CoordinateTransformation {
  const center = V3.add(bbox.topLeft, V3.scale([bbox.width, bbox.height, bbox.depth], 0.5));
  const translationMatrix = new THREE.Matrix4()
    .makeTranslation(center[0], center[1], center[2])
    .transpose();
  return { type: "affine", matrix: flatToNestedMatrix(translationMatrix.toArray()) };
}
export function getRotationMatrixAroundAxis(
  axis: "x" | "y" | "z",
  angleInRadians: number,
): CoordinateTransformation {
  const euler = new THREE.Euler();
  euler[axis] = angleInRadians;
  const rotationMatrix = new THREE.Matrix4().makeRotationFromEuler(euler).transpose();
  return { type: "affine", matrix: flatToNestedMatrix(rotationMatrix.toArray()) };
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

function _getTransformsForLayerOrNull(
  dataset: APIDataset,
  layer: APIDataLayer | APISkeletonLayer,
  nativelyRenderedLayerNames: string[],
): Transform | null {
  if (layer.category === "skeleton") {
    return getTransformsForSkeletonLayerOrNull(dataset, nativelyRenderedLayerNames);
  }
  const layerTransforms = _getOriginalTransformsForLayerOrNull(dataset, layer);

  const shouldLayerBeRenderedNatively = nativelyRenderedLayerNames.includes(layer.name);

  if (nativelyRenderedLayerName == null) {
    // No layer is requested to be rendered natively. Just use the transforms
    // as they are in the dataset.
    return layerTransforms;
  }

  if (nativelyRenderedLayerName === layer.name) {
    // This layer should be rendered without any transforms.
    return null;
  }

  // Apply the inverse of the layer that should be rendered natively
  // to the current layers transforms
  const nativeLayer = getLayerByName(dataset, nativelyRenderedLayerName, true);

  const transformsOfNativeLayer = _getOriginalTransformsForLayerOrNull(dataset, nativeLayer);

  if (transformsOfNativeLayer == null) {
    // The inverse of no transforms, are no transforms. Leave the layer
    // transforms untouched.
    return layerTransforms;
  }

  const inverseNativeTransforms = invertTransform(transformsOfNativeLayer);
  return chainTransforms(layerTransforms, inverseNativeTransforms);
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

export const getTransformsForLayerOrNull = memoizeWithThreeKeys(_getTransformsForLayerOrNull);
export function getTransformsForLayer(
  dataset: APIDataset,
  layer: APIDataLayer | APISkeletonLayer,
  nativelyRenderedLayerName: string | null,
): Transform {
  return (
    getTransformsForLayerOrNull(dataset, layer, nativelyRenderedLayerName || null) ||
    IdentityTransform
  );
}

function _getTransformsForSkeletonLayerOrNull(
  dataset: APIDataset,
  nativelyRenderedLayerNames: string[],
): Transform | null {
  if (nativelyRenderedLayerNames.length === 0) {
    // No layer is requested to be rendered natively. We can use
    // each layer's transforms as is.
    // If the dataset's layers have a consistent rotation the skeleton layer should be rotated as well.
    const layers = dataset.dataSource.dataLayers;
    const doAllLayersHaveTheSameRotation = haveAllLayersSameRotation(layers);
    if (doAllLayersHaveTheSameRotation) {
      // The skeleton layer needs to be rotated as well and translated by the dataset center.
    }
    //The skeleton layer doesn't have
    // a transforms property currently, which is why we return null.
    return null;
  }

  // Compute the inverse of the layer that should be rendered natively
  const nativeLayer = getLayerByName(dataset, nativelyRenderedLayerName, true);
  const transformsOfNativeLayer = _getOriginalTransformsForLayerOrNull(dataset, nativeLayer);

  if (transformsOfNativeLayer == null) {
    // The inverse of no transforms, are no transforms
    return null;
  }

  return invertTransform(transformsOfNativeLayer);
}

export const getTransformsForSkeletonLayerOrNull = memoizeOne(_getTransformsForSkeletonLayerOrNull);

export function getTransformsForSkeletonLayer(
  dataset: APIDataset,
  nativelyRenderedLayerName: string | null,
): Transform {
  return (
    getTransformsForSkeletonLayerOrNull(dataset, nativelyRenderedLayerName || null) ||
    IdentityTransform
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

export const getTransformsPerLayer = memoizeOne(_getTransformsPerLayer);

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
  return layers.some((layer) => _getOriginalTransformsForLayerOrNull(dataset, layer) != null);
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

const NON_SCALED_VECTOR = new THREE.Vector3(1, 1, 1);

function isTranslationOnly(transformation?: AffineTransformation) {
  if (!transformation) {
    return false;
  }
  const threeMatrix = new THREE.Matrix4()
    .fromArray(nestedToFlatMatrix(transformation.matrix))
    .transpose();
  threeMatrix.decompose(translation, quaternion, scale);
  return (
    translation.length() !== 0 &&
    scale.equals(NON_SCALED_VECTOR) &&
    quaternion.equals(new THREE.Quaternion())
  );
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

/* This function checks if all layers have the same transformation settings that represent
 * a translation to the dataset center and a rotation around each axis and a translation back.
 * All together this makes 5 affine transformation matrices. */
function _haveAllLayersSameRotation(dataLayers: Array<APIDataLayer>): boolean {
  const firstDataLayerTransformations = dataLayers[0]?.coordinateTransformations;
  if (firstDataLayerTransformations == null || firstDataLayerTransformations.length === 0) {
    // No transformations in all layers compatible with setting a rotation for the whole dataset.
    return dataLayers.every(
      (layer) =>
        layer.coordinateTransformations == null || layer.coordinateTransformations.length === 0,
    );
  }
  // There should be a translation to the origin, one transformation for each axis and one translation back. => A total of 5 affine transformations.
  if (
    dataLayers.some((layer) => layer.coordinateTransformations?.length !== 5) ||
    dataLayers.some((layer) =>
      layer.coordinateTransformations?.some((transformation) => transformation.type !== "affine"),
    )
  ) {
    return false;
  }

  if (
    !isTranslationOnly(firstDataLayerTransformations[0] as AffineTransformation) ||
    !isRotationOnly(firstDataLayerTransformations[1] as AffineTransformation) ||
    !isRotationOnly(firstDataLayerTransformations[2] as AffineTransformation) ||
    !isRotationOnly(firstDataLayerTransformations[3] as AffineTransformation) ||
    !isTranslationOnly(firstDataLayerTransformations[4] as AffineTransformation)
  ) {
    return false;
  }
  for (let i = 1; i < dataLayers.length; i++) {
    const transformations = dataLayers[i].coordinateTransformations;
    if (
      transformations == null ||
      // Not checking matrix 0 and 4 for equality as these are transformations depending on the layer's bounding box.
      // The bounding box can be different for each layer.
      !_.isEqual(transformations[1], firstDataLayerTransformations[1]) ||
      !_.isEqual(transformations[2], firstDataLayerTransformations[2]) ||
      !_.isEqual(transformations[3], firstDataLayerTransformations[3])
    ) {
      return false;
    }
  }
  return true;
}

export const haveAllLayersSameRotation = _.memoize(_haveAllLayersSameRotation);
