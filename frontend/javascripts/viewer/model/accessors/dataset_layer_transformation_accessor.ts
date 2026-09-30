import { M4x4, type Matrix4x4 } from "libs/mjs";
import MultiKeyMap from "libs/multi_key_map";
import isEqual from "lodash-es/isEqual";
import memoize from "lodash-es/memoize";
import memoizeOne from "memoize-one";
import { Matrix4, Quaternion, Vector3 as ThreeVector3 } from "three";
import type {
  AffineTransformation,
  APIDataLayer,
  APIDataset,
  APISkeletonLayer,
  CoordinateTransformation,
} from "types/api_types";
import { Identity4x4, IdentityTransform, type Vector3, Vector3Indices } from "viewer/constants";
import type { WebknossosState } from "viewer/store";
import BoundingBox from "../bucket_data_handling/bounding_box";
import {
  cosineLocationOfRotationInMatrix,
  doAllLayersHaveTheSameRotation,
  fromCenterToOriginAsAffine,
  fromOriginToCenterAsAffine,
  getRotationMatrixAroundAxis,
  isTranslationOnly,
  sinusLocationOfRotationInMatrix,
} from "../helpers/dataset_rotation_helpers";
import {
  chainTransforms,
  createAffineTransformFromMatrix,
  createThinPlateSplineTransform,
  flatToNestedMatrix,
  invertTransform,
  nestedToFlatMatrix,
  type Transform,
  transformPointUnscaled,
} from "../helpers/transformation_helpers";
import { getDataLayers, getLayerBoundingBox, getLayerByName } from "./dataset_accessor";

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

const NON_SCALED_VECTOR = new ThreeVector3(1, 1, 1);
const EPSILON = 0.0001;

function isRotationOnly(transformation?: AffineTransformation) {
  if (!transformation) {
    return false;
  }
  const threeMatrix = new Matrix4()
    .fromArray(nestedToFlatMatrix(transformation.matrix))
    .transpose();
  threeMatrix.decompose(translation, quaternion, scale);
  return translation.length() <= EPSILON && scale.distanceTo(NON_SCALED_VECTOR) < EPSILON;
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
    if (Math.abs(m[i][3]) > EPSILON) return false; // Checks translation component to be 0.
  }
  return (
    Math.abs(m[3][0]) <= EPSILON && // checks projection component
    Math.abs(m[3][1]) <= EPSILON && // checks projection component
    Math.abs(m[3][2]) <= EPSILON && // checks projection component
    Math.abs(m[3][3] - 1) <= EPSILON // checks w component
  );
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

// Unlike getUntransformedDatasetBoundingBox (dataset_accessor.ts), this variant takes each
// layer's coordinate transforms (relative to nativelyRenderedLayerName) into account. Since
// different layers can have different transforms, the axis-aligned extent has to be computed
// per layer (by transforming its 8 corners) before taking the union across layers.
// Reminder: The returned bounding box'es max value is exclusive to the dataset.
function _getTransformedDatasetBoundingBox(
  dataset: APIDataset,
  nativelyRenderedLayerName: string | null,
): BoundingBox {
  const min: Vector3 = [
    Number.POSITIVE_INFINITY,
    Number.POSITIVE_INFINITY,
    Number.POSITIVE_INFINITY,
  ];
  const max: Vector3 = [
    Number.NEGATIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
  ];

  for (const dataLayer of getDataLayers(dataset)) {
    const layerBox = getLayerBoundingBox(dataset, dataLayer.name);
    const transform = getTransformsForLayerOrNull(dataset, dataLayer, nativelyRenderedLayerName);
    const corners = new BoundingBox(layerBox).getCorners();
    const transformedCorners = transform ? corners.map(transformPointUnscaled(transform)) : corners;

    for (const corner of transformedCorners) {
      for (const i of Vector3Indices) {
        min[i] = Math.min(min[i], corner[i]);
        max[i] = Math.max(max[i], corner[i]);
      }
    }
  }

  return new BoundingBox({
    min,
    max,
  });
}

export const getTransformedDatasetBoundingBox = memoizeOne(_getTransformedDatasetBoundingBox);

export function getTransformedDatasetCenter(
  dataset: APIDataset,
  nativelyRenderedLayerName: string | null,
): Vector3 {
  return getTransformedDatasetBoundingBox(dataset, nativelyRenderedLayerName).getCenter();
}

// The live SRT transform format uses exactly 7 affine matrices in this order:
// [0]  dataset center → origin translation, [1] scale, [2] rotX, [3] rotY, [4] rotZ,
// [5] user translation, [6] origin → center dataset translation.
// They are stored separately to keep the extracted value consistent between reloads.
// Else e.g. some rotations might be shown differently as euler angles are not deterministic.
export const EXPECTED_LIVE_TRANSFORMATION_LENGTH = 7;
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
export function hasValidLiveTransformationPattern(
  transforms: CoordinateTransformation[] | null | undefined,
): boolean {
  if (transforms == null || transforms.length === 0) return true;
  if (transforms.length !== EXPECTED_LIVE_TRANSFORMATION_LENGTH) return false;
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
  if (transforms.length !== EXPECTED_LIVE_TRANSFORMATION_LENGTH) return DEFAULT_SRT;
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
