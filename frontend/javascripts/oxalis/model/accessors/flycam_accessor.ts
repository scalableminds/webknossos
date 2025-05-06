import type { Matrix4x4 } from "libs/mjs";
import { M4x4, V3 } from "libs/mjs";
import { map3, mod } from "libs/utils";
import _ from "lodash";
import memoizeOne from "memoize-one";
import type {
  OrthoView,
  OrthoViewMap,
  OrthoViewRects,
  Vector2,
  Vector3,
  Vector4,
  ViewMode,
} from "oxalis/constants";
import constants, { OrthoViews } from "oxalis/constants";
import {
  getColorLayers,
  getDataLayers,
  getDenseMagsForLayerName,
  getEnabledLayers,
  getLayerByName,
  getMagInfo,
  getMaxZoomStep,
} from "oxalis/model/accessors/dataset_accessor";
import { getViewportRects } from "oxalis/model/accessors/view_mode_accessor";
import determineBucketsForFlight from "oxalis/model/bucket_data_handling/bucket_picker_strategies/flight_bucket_picker";
import determineBucketsForOblique from "oxalis/model/bucket_data_handling/bucket_picker_strategies/oblique_bucket_picker";
import { MAX_ZOOM_STEP_DIFF } from "oxalis/model/bucket_data_handling/loading_strategy_logic";
import Dimensions from "oxalis/model/dimensions";
import * as scaleInfo from "oxalis/model/scaleinfo";
import { getBaseVoxelInUnit } from "oxalis/model/scaleinfo";
import type { DataLayerType, Flycam, LoadingStrategy, WebknossosState } from "oxalis/store";
import * as THREE from "three";
import type { AdditionalCoordinate, VoxelSize } from "types/api_types";
import { baseDatasetViewConfiguration } from "types/schemas/dataset_view_configuration.schema";
import type { SmallerOrHigherInfo } from "../helpers/mag_info";
import {
  type Transform,
  chainTransforms,
  invertTransform,
  transformPointUnscaled,
} from "../helpers/transformation_helpers";
import { getMatrixScale, rotateOnAxis } from "../reducers/flycam_reducer";
import { reuseInstanceOnEquality } from "./accessor_helpers";

export const ZOOM_STEP_INTERVAL = 1.1;

function calculateTotalBucketCountForZoomLevel(
  viewMode: ViewMode,
  loadingStrategy: LoadingStrategy,
  mags: Array<Vector3>,
  logZoomStep: number,
  zoomFactor: number,
  viewportRects: OrthoViewRects,
  unzoomedMatrix: Matrix4x4,
  abortLimit: number,
) {
  let counter = 0;

  const addresses = [];
  const enqueueFunction = (bucketAddress: Vector4) => {
    counter++;
    addresses.push(bucketAddress);
  };

  // Define dummy values
  const position: Vector3 = [0, 0, 0];
  const sphericalCapRadius = constants.DEFAULT_SPHERICAL_CAP_RADIUS;
  const matrix = M4x4.scale1(zoomFactor, unzoomedMatrix);

  if (viewMode === constants.MODE_ARBITRARY_PLANE) {
    determineBucketsForOblique(
      viewMode,
      loadingStrategy,
      mags,
      position,
      enqueueFunction,
      matrix,
      logZoomStep,
      viewportRects,
      abortLimit,
    );
  } else if (viewMode === constants.MODE_ARBITRARY) {
    determineBucketsForFlight(
      mags,
      position,
      sphericalCapRadius,
      enqueueFunction,
      matrix,
      logZoomStep,
      abortLimit,
    );
  } else {
    determineBucketsForOblique(
      viewMode,
      loadingStrategy,
      mags,
      position,
      enqueueFunction,
      matrix,
      logZoomStep,
      viewportRects,
      abortLimit,
    );
  }

  return counter;
}

// This function returns the maximum zoom value in which a given magnification (magIndex)
// can be rendered without exceeding the necessary bucket capacity.
// Similar to other functions in this module, the function name is prefixed with _ which means
// that there is a memoized function as a counterpart (which is not prefixed with _).
// Example:
// The function might return 1.3 for magIndex 0, which means that until a zoom value of 1.3
// the first magnification can still be rendered.
// For magIndex 1, the function might return 1.5 etc.
// These values are used to determine the appropriate magnification for a given zoom value (e.g., a zoom value of 1.4
// would require the second magnification).
// This function is only exported for testing purposes
export function _getMaximumZoomForAllMags(
  viewMode: ViewMode,
  loadingStrategy: LoadingStrategy,
  voxelSizeFactor: Vector3,
  mags: Array<Vector3>,
  viewportRects: OrthoViewRects,
  maximumCapacity: number,
  layerMatrix: Matrix4x4,
  flycamMatrix: Matrix4x4,
): Array<number> {
  const unzoomedMatrix = M4x4.mul(layerMatrix, flycamMatrix);

  // This function determines which zoom value ranges are valid for the given magnifications.
  // The calculation iterates through several zoom values and checks the required bucket capacity
  // against the capacity supported by the GPU.
  // In each iteration, the last zoom value is incremented as if the user performed a zoom-out action.
  //
  // In theory, we could simply abort the loop once a maximum zoom value was found for all magnifications.
  // However, to avoid an infinite loop in case of violated assumptions (e.g., because the calculated
  // bucket size isn't strictly increasing anymore), we calculate an iteration limit.

  // For that limit, we specify how many magnifications we want to support at least.
  // 15 magnifications means that the highest mag would be something like [32768, 32768, 1024].
  const MAX_SUPPORTED_MAGNIFICATION_COUNT = 15;
  // From that, we calculate the theoretical maximum zoom value. The dataset scale is taken into account,
  // because the entire scene is scaled with that.
  const maxSupportedZoomValue =
    2 ** MAX_SUPPORTED_MAGNIFICATION_COUNT * Math.max(...voxelSizeFactor);
  // Since the viewports can be quite large, it can happen that even a zoom value of 1 is not feasible.
  // That's why we start the search with a smaller value than 1. We use the ZOOM_STEP_INTERVAL factor
  // to ensure that the calculated thresholds correspond to the normal zoom behavior.
  const ZOOM_IN_START_EXPONENT = 20;
  let currentMaxZoomValue = 1 / ZOOM_STEP_INTERVAL ** ZOOM_IN_START_EXPONENT;
  const maximumIterationCount =
    Math.log(maxSupportedZoomValue) / Math.log(ZOOM_STEP_INTERVAL) + ZOOM_IN_START_EXPONENT;

  let currentIterationCount = 0;
  let currentMagIndex = 0;
  const maxZoomValueThresholds = [];

  if (typeof maximumCapacity !== "number" || isNaN(maximumCapacity)) {
    // If maximumCapacity is NaN for some reason, the following loop will
    // never terminate (causing webKnossos to hang).
    throw new Error("Internal error: Invalid maximum capacity provided.");
  }

  while (currentIterationCount < maximumIterationCount && currentMagIndex < mags.length) {
    const nextZoomValue = currentMaxZoomValue * ZOOM_STEP_INTERVAL;
    const nextCapacity = calculateTotalBucketCountForZoomLevel(
      viewMode,
      loadingStrategy,
      mags,
      currentMagIndex,
      nextZoomValue,
      viewportRects,
      unzoomedMatrix,
      // The bucket picker will stop after reaching the maximum capacity.
      // Increment the limit by one, so that rendering is still possible
      // when exactly meeting the limit.
      maximumCapacity + 1,
    );

    if (nextCapacity > maximumCapacity) {
      maxZoomValueThresholds.push(currentMaxZoomValue);
      currentMagIndex++;
    }

    currentMaxZoomValue = nextZoomValue;
    currentIterationCount++;
  }

  return maxZoomValueThresholds;
}

// Only exported for testing.
export const _getDummyFlycamMatrix = memoizeOne((scale: Vector3) => {
  const scaleMatrix = getMatrixScale(scale);
  return rotateOnAxis(M4x4.scale(scaleMatrix, M4x4.identity(), []), Math.PI, [0, 0, 1]);
});

export function getMoveOffset(state: WebknossosState, timeFactor: number) {
  return (
    (state.userConfiguration.moveValue * timeFactor) /
    getBaseVoxelInUnit(state.dataset.dataSource.scale.factor) /
    constants.FPS
  );
}

export function getMoveOffset3d(state: WebknossosState, timeFactor: number) {
  const { moveValue3d } = state.userConfiguration;
  const baseVoxel = getBaseVoxelInUnit(state.dataset.dataSource.scale.factor);
  return (moveValue3d * timeFactor) / baseVoxel / constants.FPS;
}

function getMaximumZoomForAllMagsFromStore(
  state: WebknossosState,
  layerName: string,
): Array<number> {
  const zoomValues = state.flycamInfoCache.maximumZoomForAllMags[layerName];
  if (zoomValues) {
    return zoomValues;
  }
  // If the maintainMaximumZoomForAllMagsSaga has not populated the store yet,
  // we use the following fallback heuristic. In production, this should not be
  // relevant (an empty array would also work, because this would just lead to the coarsest
  // mag being chosen for a brief period of time).
  // However, for the tests, it is useful to have this heuristic. Otherwise, we would need
  // to ensure that the relevant saga runs in every unit test setup (or in general, that the ranges
  // are set up properly).
  return getDenseMagsForLayerName(state.dataset, layerName).map((_mag, idx) => 2 ** (idx + 1));
}

// This function depends on functionality from this and the dataset_layer_transformation_accessor module.
// To avoid cyclic dependencies and as the result of the function is a position and scale change,
// this function is arguably semantically closer to this flycam module.
export function getNewPositionAndZoomChangeFromTransformationChange(
  activeTransformation: Transform,
  nextTransform: Transform,
  state: WebknossosState,
) {
  // Calculate the difference between the current and the next transformation.
  const currentTransformInverted = invertTransform(activeTransformation);
  const changeInAppliedTransformation = chainTransforms(currentTransformInverted, nextTransform);

  const currentPosition = getPosition(state.flycam);
  const newPosition = transformPointUnscaled(changeInAppliedTransformation)(currentPosition);

  // Also transform a reference coordinate to determine how the scaling
  // changed. Then, adapt the zoom accordingly.

  const referenceOffset: Vector3 = [10, 10, 10];
  const secondPosition = V3.add(currentPosition, referenceOffset, [0, 0, 0]);
  const newSecondPosition = transformPointUnscaled(changeInAppliedTransformation)(secondPosition);

  const scaleChange = _.mean(
    // Only consider XY for now to determine the zoom change (by slicing from 0 to 2)
    V3.abs(V3.divide3(V3.sub(newPosition, newSecondPosition), referenceOffset)).slice(0, 2),
  );

  return { newPosition, scaleChange };
}

function _getUp(flycam: Flycam): Vector3 {
  const matrix = flycam.currentMatrix;
  return [matrix[4], matrix[5], matrix[6]];
}

function _getLeft(flycam: Flycam): Vector3 {
  const matrix = flycam.currentMatrix;
  return [matrix[0], matrix[1], matrix[2]];
}

function _getPosition(flycam: Flycam): Vector3 {
  const matrix = flycam.currentMatrix;
  return [matrix[12], matrix[13], matrix[14]];
}

export function hasAdditionalCoordinates(
  additionalCoordinates: AdditionalCoordinate[] | null | undefined,
): boolean {
  return (additionalCoordinates?.length || 0) > 0;
}

export function getAdditionalCoordinatesAsString(
  additionalCoordinates: AdditionalCoordinate[] | null | undefined,
  separator: string = ";",
): string {
  if (additionalCoordinates != null && additionalCoordinates.length > 0) {
    return additionalCoordinates
      ?.map((coordinate) => `${coordinate.name}=${coordinate.value}`)
      .join(separator);
  }
  return "";
}

function _getFlooredPosition(flycam: Flycam): Vector3 {
  return map3((x) => Math.floor(x), _getPosition(flycam));
}

function _getRotationInRadianFixed(flycam: Flycam): Vector3 {
  const object = new THREE.Object3D();
  const matrix = new THREE.Matrix4().fromArray(flycam.currentMatrix).transpose();
  object.applyMatrix4(matrix);
  const rotation: Vector3 = [object.rotation.x, object.rotation.y - Math.PI, object.rotation.z];
  return [
    mod(rotation[0], Math.PI*2),
    mod(rotation[1], Math.PI*2),
    mod(rotation[2], Math.PI*2),
  ];
}

function _getRotationInRadian(flycam: Flycam): Vector3 {
  const object = new THREE.Object3D();
  const matrix = new THREE.Matrix4().fromArray(flycam.currentMatrix).transpose();
  object.applyMatrix4(matrix);
  const rotation: Vector3 = [object.rotation.x, object.rotation.y, object.rotation.z - Math.PI];
  return [
    mod(rotation[0], Math.PI*2),
    mod(rotation[1], Math.PI*2),
    mod(rotation[2], Math.PI*2),
  ];
}

function _getRotationInDegrees(flycam: Flycam): Vector3 {
  const rotationInRadian = getRotationInRadian(flycam);
  // Modulo operation not needed as already done in getRotationInRadian.
  return [
    (180 / Math.PI) * rotationInRadian[0],
    (180 / Math.PI) * rotationInRadian[1],
    (180 / Math.PI) * rotationInRadian[2],
  ]
}

function _getZoomedMatrix(flycam: Flycam): Matrix4x4 {
  return M4x4.scale1(flycam.zoomStep, flycam.currentMatrix);
}

export const getUp = memoizeOne(_getUp);
export const getLeft = memoizeOne(_getLeft);
export const getPosition = memoizeOne(_getPosition);
export const getFlooredPosition = memoizeOne(_getFlooredPosition);
export const getRotationInRadianFixed = memoizeOne(_getRotationInRadianFixed);
export const getRotationInRadian = memoizeOne(_getRotationInRadian);
export const getRotationInDegrees = memoizeOne(_getRotationInDegrees);
export const getZoomedMatrix = memoizeOne(_getZoomedMatrix);

function _getActiveMagIndicesForLayers(state: WebknossosState): { [layerName: string]: number } {
  const magIndices: { [layerName: string]: number } = {};

  for (const layer of getDataLayers(state.dataset)) {
    const maximumZoomSteps = getMaximumZoomForAllMagsFromStore(state, layer.name);
    const maxLogZoomStep = Math.log2(getMaxZoomStep(state.dataset));

    // Linearly search for the mag index, for which the zoomFactor
    // is acceptable.
    const zoomStep = _.findIndex(
      maximumZoomSteps,
      (maximumZoomStep) => state.flycam.zoomStep <= maximumZoomStep,
    );

    if (zoomStep === -1) {
      magIndices[layer.name] = maxLogZoomStep;
    } else {
      magIndices[layer.name] = Math.min(zoomStep, maxLogZoomStep);
    }
  }

  return magIndices;
}

export const getActiveMagIndicesForLayers = reuseInstanceOnEquality(_getActiveMagIndicesForLayers);

/*
  Note that the return value indicates which mag can be rendered theoretically for the given layer
   (ignoring which mags actually exist). This means the return mag index might not exist for the given layer.
 */
export function getActiveMagIndexForLayer(state: WebknossosState, layerName: string): number {
  return getActiveMagIndicesForLayers(state)[layerName];
}

/*
  Returns the mag that is supposed to be rendered for the given layer. The return mag
  is independent of the actually loaded data. If null is returned, the layer cannot be rendered,
  because no appropriate mag exists.
 */
export function getCurrentMag(
  state: WebknossosState,
  layerName: string,
): Vector3 | null | undefined {
  const magInfo = getMagInfo(getLayerByName(state.dataset, layerName).resolutions);
  const magIndex = getActiveMagIndexForLayer(state, layerName);
  const existingMagIndex = magInfo.getIndexOrClosestHigherIndex(magIndex);
  if (existingMagIndex == null) {
    return null;
  }
  return magInfo.getMagByIndex(existingMagIndex);
}

function _getValidZoomRangeForUser(state: WebknossosState): [number, number] {
  const maxOfLayers = _.max(
    getDataLayers(state.dataset).map((layer) => {
      const maximumZoomSteps = getMaximumZoomForAllMagsFromStore(state, layer.name);
      return _.last(maximumZoomSteps);
    }),
  );

  const [min, taskAwareMax] = getValidTaskZoomRange(state);
  const max = maxOfLayers != null ? Math.min(taskAwareMax, maxOfLayers) : 1;
  return [min, max];
}

export const getValidZoomRangeForUser = reuseInstanceOnEquality(_getValidZoomRangeForUser);

export function getMaxZoomValueForMag(
  state: WebknossosState,
  layerName: string,
  targetMag: Vector3,
): number {
  const targetMagIdentifier = Math.max(...targetMag);
  // Extract the max value from the range
  const maxZoom = getValidZoomRangeForMag(state, layerName, targetMagIdentifier)[1];
  if (maxZoom == null) {
    // This should never happen as long as a valid target mag is passed to this function.
    throw new Error("Zoom range could not be determined for target magnification.");
  }
  return maxZoom;
}

function getValidZoomRangeForMag(
  state: WebknossosState,
  layerName: string,
  magIdentifier: number,
): Vector2 | [null, null] {
  const maximumZoomSteps = getMaximumZoomForAllMagsFromStore(state, layerName);
  // maximumZoomSteps is densely defined for all mags starting from magnification 1,1,1.
  // Therefore, we can use log2 as an index.
  const targetMagIndex = Math.log2(magIdentifier);

  if (targetMagIndex > maximumZoomSteps.length) {
    return [null, null];
  }

  const max = maximumZoomSteps[targetMagIndex];
  const min = targetMagIndex > 0 ? maximumZoomSteps[targetMagIndex - 1] : 0;
  // Since the min of the requested range is derived from the max of the previous range,
  // we add a small delta so that the returned range is inclusive.
  return [min + Number.EPSILON, max];
}

export function getZoomValue(flycam: Flycam): number {
  return flycam.zoomStep;
}
export function getValidTaskZoomRange(
  state: WebknossosState,
  respectRestriction: boolean = false,
): [number, number] {
  const defaultRange = [
    baseDatasetViewConfiguration.zoom.minimum,
    Number.POSITIVE_INFINITY,
  ] as Vector2;
  const { magRestrictions } = state.annotation.restrictions;
  // We use the first color layer as a heuristic to check the validity of the zoom range,
  // as we don't know to which layer a restriction is meant to be applied.
  // If the layers don't have any transforms, the layer choice doesn't matter, anyway.
  // Tracked in #6926.
  const firstColorLayerNameMaybe = _.first(getColorLayers(state.dataset))?.name;

  if (!respectRestriction || !firstColorLayerNameMaybe) {
    return defaultRange;
  }

  const firstColorLayerName = firstColorLayerNameMaybe;

  function getMinMax(magIdentifier: number | undefined, isMin: boolean) {
    const idx = isMin ? 0 : 1;
    return (
      (magIdentifier == null
        ? defaultRange[idx]
        : // If the magIdentifier is defined, but doesn't match any mag, we default to the defaultRange values
          getValidZoomRangeForMag(state, firstColorLayerName, magIdentifier)[idx]) ||
      defaultRange[idx]
    );
  }

  const min = getMinMax(magRestrictions.min, true);
  const max = getMinMax(magRestrictions.max, false);
  return [min, max];
}

export function isMagRestrictionViolated(state: WebknossosState): boolean {
  const { magRestrictions } = state.annotation.restrictions;
  // We use the first color layer as a heuristic to check the validity of the zoom range,
  // as we don't know to which layer a restriction is meant to be applied.
  // If the layers don't have any transforms, the layer choice doesn't matter, anyway.
  // Tracked in #6926.
  const firstColorLayerName = _.first(getColorLayers(state.dataset))?.name;
  if (!firstColorLayerName) {
    return false;
  }
  const zoomStep = getActiveMagIndexForLayer(state, firstColorLayerName);

  if (magRestrictions.min != null && zoomStep < Math.log2(magRestrictions.min)) {
    return true;
  }

  if (magRestrictions.max != null && zoomStep > Math.log2(magRestrictions.max)) {
    return true;
  }

  return false;
}

export function getPlaneExtentInVoxel(
  rects: OrthoViewRects,
  zoomStep: number,
  planeID: OrthoView,
): [number, number] {
  const { width, height } = rects[planeID];
  return [width * zoomStep, height * zoomStep];
}
export function getRotationOrtho(planeId: OrthoView): Vector3 {
  switch (planeId) {
    case OrthoViews.PLANE_YZ:
      return [0, 270, 0];

    case OrthoViews.PLANE_XZ:
      return [90, 0, 0];

    case OrthoViews.PLANE_XY:
    default:
      return [0, 0, 0];
  }
}
export type Area = {
  left: number;
  top: number;
  right: number;
  bottom: number;
  isVisible: boolean;
};

function getArea(
  rects: OrthoViewRects,
  position: Vector3,
  zoomStep: number,
  voxelSize: VoxelSize,
  planeId: OrthoView,
): Area {
  const [u, v] = Dimensions.getIndices(planeId);
  const [viewportWidthHalf, viewportHeightHalf] = getPlaneExtentInVoxel(
    rects,
    zoomStep,
    planeId,
  ).map((el) => el / 2);
  const baseVoxelFactors = scaleInfo.getBaseVoxelFactorsInUnit(voxelSize);
  const uHalf = viewportWidthHalf * baseVoxelFactors[u];
  const vHalf = viewportHeightHalf * baseVoxelFactors[v];
  const isVisible = uHalf > 0 && vHalf > 0;
  const left = Math.floor((position[u] - uHalf) / constants.BUCKET_WIDTH);
  const top = Math.floor((position[v] - vHalf) / constants.BUCKET_WIDTH);
  const right = Math.floor((position[u] + uHalf) / constants.BUCKET_WIDTH);
  const bottom = Math.floor((position[v] + vHalf) / constants.BUCKET_WIDTH);
  return {
    left,
    top,
    right,
    bottom,
    isVisible,
  };
}

function getAreas(
  rects: OrthoViewRects,
  position: Vector3,
  zoomStep: number,
  voxelSize: VoxelSize,
): OrthoViewMap<Area> {
  // @ts-expect-error ts-migrate(2741) FIXME: Property 'TDView' is missing in type '{ PLANE_XY: ... Remove this comment to see the full error message
  return {
    [OrthoViews.PLANE_XY]: getArea(rects, position, zoomStep, voxelSize, OrthoViews.PLANE_XY),
    [OrthoViews.PLANE_XZ]: getArea(rects, position, zoomStep, voxelSize, OrthoViews.PLANE_XZ),
    [OrthoViews.PLANE_YZ]: getArea(rects, position, zoomStep, voxelSize, OrthoViews.PLANE_YZ),
  };
}

export function getAreasFromState(state: WebknossosState): OrthoViewMap<Area> {
  const position = getPosition(state.flycam);
  const rects = getViewportRects(state);
  const { zoomStep } = state.flycam;
  const voxelSize = state.dataset.dataSource.scale;
  return getAreas(rects, position, zoomStep, voxelSize);
}

type UnrenderableLayersInfos = {
  layer: DataLayerType;
  smallerOrHigherInfo: SmallerOrHigherInfo;
};

/*
  This function returns layers that cannot be rendered (since the current mag is missing),
  even though they should be rendered (since they are enabled). For each layer, this method
  additionally returns whether data of this layer can be rendered by zooming in or out.
  The function takes fallback mags into account if renderMissingDataBlack is disabled.
 */
function _getUnrenderableLayerInfosForCurrentZoom(
  state: WebknossosState,
): Array<UnrenderableLayersInfos> {
  const { dataset } = state;
  const activeMagIndices = getActiveMagIndicesForLayers(state);
  const { renderMissingDataBlack } = state.datasetConfiguration;
  const unrenderableLayers = getEnabledLayers(dataset, state.datasetConfiguration)
    .map((layer: DataLayerType) => ({
      layer,
      activeMagIdx: activeMagIndices[layer.name],
      magInfo: getMagInfo(layer.resolutions),
    }))
    .filter(({ activeMagIdx, magInfo: magInfo }) => {
      const isPresent = magInfo.hasIndex(activeMagIdx);

      if (isPresent) {
        // The layer exists. Thus, it is not unrenderable.
        return false;
      }

      if (renderMissingDataBlack) {
        // We already know that the layer is missing. Since `renderMissingDataBlack`
        // is enabled, the fallback mags don't matter. The layer cannot be
        // rendered.
        return true;
      }

      // The current mag is missing and fallback rendering
      // is activated. Thus, check whether one of the fallback
      // zoomSteps can be rendered.
      return !_.range(1, MAX_ZOOM_STEP_DIFF + 1).some((diff) => {
        const fallbackZoomStep = activeMagIdx + diff;
        return magInfo.hasIndex(fallbackZoomStep);
      });
    })
    .map<UnrenderableLayersInfos>(({ layer, magInfo, activeMagIdx }) => {
      const smallerOrHigherInfo = magInfo.hasSmallerAndOrHigherIndex(activeMagIdx);
      return {
        layer,
        smallerOrHigherInfo,
      };
    });
  return unrenderableLayers;
}

export const getUnrenderableLayerInfosForCurrentZoom = reuseInstanceOnEquality(
  _getUnrenderableLayerInfosForCurrentZoom,
);

function _getActiveMagInfo(state: WebknossosState) {
  const enabledLayers = getEnabledLayers(state.dataset, state.datasetConfiguration);
  const activeMagIndices = getActiveMagIndicesForLayers(state);
  const activeMagIndicesOfEnabledLayers = Object.fromEntries(
    enabledLayers.map((l) => [l.name, activeMagIndices[l.name]]),
  );
  const activeMagOfEnabledLayers = Object.fromEntries(
    enabledLayers.map((l) => [
      l.name,
      getMagInfo(l.resolutions).getMagByIndex(activeMagIndices[l.name]),
    ]),
  );

  const isActiveMagGlobal =
    _.uniqBy(Object.values(activeMagOfEnabledLayers), (mag) => (mag != null ? mag.join("-") : null))
      .length === 1;
  let representativeMag: Vector3 | undefined | null;
  if (isActiveMagGlobal) {
    representativeMag = Object.values(activeMagOfEnabledLayers)[0];
  } else {
    const activeMags = Object.values(activeMagOfEnabledLayers).filter((mag) => !!mag) as Vector3[];

    // Find the "best" mag by sorting by the best magnification factor (use the second-best and third-best
    // factor as a tie breaker).
    // That way, having the mags [[4, 4, 1], [2, 2, 1], [8, 8, 1]] will yield [2, 2, 1] as a representative,
    // even though all mags have the same minimum.
    const activeMagsWithSorted = activeMags.map((mag) => ({
      mag, // e.g., 4, 4, 1
      sortedMag: _.sortBy(mag), // e.g., 1, 4, 4
    }));
    representativeMag = _.sortBy(
      activeMagsWithSorted,
      ({ sortedMag }) => sortedMag[0],
      ({ sortedMag }) => sortedMag[1],
      ({ sortedMag }) => sortedMag[2],
    )[0]?.mag;
  }

  return {
    representativeMag,
    activeMagIndicesOfEnabledLayers,
    activeMagOfEnabledLayers,
    isActiveMagGlobal,
  };
}

export const getActiveMagInfo = reuseInstanceOnEquality(_getActiveMagInfo);
