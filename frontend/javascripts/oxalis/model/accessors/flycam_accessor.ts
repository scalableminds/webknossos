import * as THREE from "three";
import _ from "lodash";
import memoizeOne from "memoize-one";
import type { DataLayerType, Flycam, LoadingStrategy, OxalisState } from "oxalis/store";
import { Matrix4x4 } from "libs/mjs";
import { M4x4 } from "libs/mjs";
import { getViewportRects } from "oxalis/model/accessors/view_mode_accessor";
import {
  getColorLayers,
  getDataLayers,
  getEnabledLayers,
  getLayerByName,
  getMaxZoomStep,
  getResolutionInfo,
  getTransformsForLayer,
  invertAndTranspose,
} from "oxalis/model/accessors/dataset_accessor";
import { map3, mod } from "libs/utils";
import Dimensions from "oxalis/model/dimensions";
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
import determineBucketsForFlight from "oxalis/model/bucket_data_handling/bucket_picker_strategies/flight_bucket_picker";
import determineBucketsForOblique from "oxalis/model/bucket_data_handling/bucket_picker_strategies/oblique_bucket_picker";
import * as scaleInfo from "oxalis/model/scaleinfo";
import { reuseInstanceOnEquality } from "./accessor_helpers";
import { baseDatasetViewConfiguration } from "types/schemas/dataset_view_configuration.schema";
import { MAX_ZOOM_STEP_DIFF } from "oxalis/model/bucket_data_handling/loading_strategy_logic";
import { getMatrixScale, rotateOnAxis } from "../reducers/flycam_reducer";
import { SmallerOrHigherInfo } from "../helpers/resolution_info";
import { getBaseVoxelInUnit } from "oxalis/model/scaleinfo";
import { AdditionalCoordinate, VoxelSize } from "types/api_flow_types";

export const ZOOM_STEP_INTERVAL = 1.1;

function calculateTotalBucketCountForZoomLevel(
  viewMode: ViewMode,
  loadingStrategy: LoadingStrategy,
  resolutions: Array<Vector3>,
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
      resolutions,
      position,
      enqueueFunction,
      matrix,
      logZoomStep,
      viewportRects,
      abortLimit,
    );
  } else if (viewMode === constants.MODE_ARBITRARY) {
    determineBucketsForFlight(
      resolutions,
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
      resolutions,
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

// This function returns the maximum zoom value in which a given magnification (resolutionIndex)
// can be rendered without exceeding the necessary bucket capacity.
// Similar to other functions in this module, the function name is prefixed with _ which means
// that there is a memoized function as a counterpart (which is not prefixed with _).
// Example:
// The function might return 1.3 for resolutionIndex 0, which means that until a zoom value of 1.3
// the first magnification can still be rendered.
// For resolutionIndex 1, the function might return 1.5 etc.
// These values are used to determine the appropriate magnification for a given zoom value (e.g., a zoom value of 1.4
// would require the second magnification).
// This function is only exported for testing purposes
export function _getMaximumZoomForAllResolutions(
  viewMode: ViewMode,
  loadingStrategy: LoadingStrategy,
  voxelSizeFactor: Vector3,
  resolutions: Array<Vector3>,
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
  let currentResolutionIndex = 0;
  const maxZoomValueThresholds = [];

  if (typeof maximumCapacity !== "number" || isNaN(maximumCapacity)) {
    // If maximumCapacity is NaN for some reason, the following loop will
    // never terminate (causing webKnossos to hang).
    throw new Error("Internal error: Invalid maximum capacity provided.");
  }

  while (
    currentIterationCount < maximumIterationCount &&
    currentResolutionIndex < resolutions.length
  ) {
    const nextZoomValue = currentMaxZoomValue * ZOOM_STEP_INTERVAL;
    const nextCapacity = calculateTotalBucketCountForZoomLevel(
      viewMode,
      loadingStrategy,
      resolutions,
      currentResolutionIndex,
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
      currentResolutionIndex++;
    }

    currentMaxZoomValue = nextZoomValue;
    currentIterationCount++;
  }

  return maxZoomValueThresholds;
}

// todo: make this cleaner. since the maximum zoom depends on the layer name and the right matrix,
// a memoization cache size of one doesn't work anymore. move cache to store and update explicitly?
const perLayerFnCache: Map<string, typeof _getMaximumZoomForAllResolutions> = new Map();

// Only exported for testing.
export const _getDummyFlycamMatrix = memoizeOne((scale: Vector3) => {
  const scaleMatrix = getMatrixScale(scale);
  return rotateOnAxis(M4x4.scale(scaleMatrix, M4x4.identity, []), Math.PI, [0, 0, 1]);
});

export function getMoveOffset(state: OxalisState, timeFactor: number) {
  return (
    (state.userConfiguration.moveValue * timeFactor) /
    getBaseVoxelInUnit(state.dataset.dataSource.scale.factor) /
    constants.FPS
  );
}

export function getMoveOffset3d(state: OxalisState, timeFactor: number) {
  const { moveValue3d } = state.userConfiguration;
  const baseVoxel = getBaseVoxelInUnit(state.dataset.dataSource.scale.factor);
  return (moveValue3d * timeFactor) / baseVoxel / constants.FPS;
}

function getMaximumZoomForAllResolutionsFromStore(
  state: OxalisState,
  layerName: string,
): Array<number> {
  const { viewMode } = state.temporaryConfiguration;

  const layer = getLayerByName(state.dataset, layerName);
  const layerMatrix = invertAndTranspose(
    getTransformsForLayer(
      state.dataset,
      layer,
      state.datasetConfiguration.nativelyRenderedLayerName,
    ).affineMatrix,
  );

  let fn = perLayerFnCache.get(layerName);
  if (fn == null) {
    fn = memoizeOne(_getMaximumZoomForAllResolutions);
    perLayerFnCache.set(layerName, fn);
  }

  const dummyFlycamMatrix = _getDummyFlycamMatrix(state.dataset.dataSource.scale.factor);

  return fn(
    viewMode,
    state.datasetConfiguration.loadingStrategy,
    state.dataset.dataSource.scale.factor,
    getResolutionInfo(layer.resolutions).getDenseResolutions(),
    getViewportRects(state),
    Math.min(
      state.temporaryConfiguration.gpuSetup.smallestCommonBucketCapacity,
      constants.GPU_FACTOR_MULTIPLIER * state.userConfiguration.gpuMemoryFactor,
    ),
    layerMatrix,
    // Theoretically, the following parameter should be state.flycam.currentMatrix.
    // However, that matrix changes on each move which means that the ranges would need
    // to be recalculate on each move. At least, for orthogonal mode, the actual matrix
    // should only differ in its translation which can be ignored for gauging the maximum
    // zoom here.
    // However, for oblique and flight mode this is not really accurate. As a heuristic,
    // this already proved to be fine, though.
    dummyFlycamMatrix,
  );
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

function _getRotation(flycam: Flycam): Vector3 {
  const object = new THREE.Object3D();
  const matrix = new THREE.Matrix4().fromArray(flycam.currentMatrix).transpose();
  object.applyMatrix4(matrix);
  const rotation: Vector3 = [object.rotation.x, object.rotation.y, object.rotation.z - Math.PI];
  return [
    mod((180 / Math.PI) * rotation[0], 360),
    mod((180 / Math.PI) * rotation[1], 360),
    mod((180 / Math.PI) * rotation[2], 360),
  ];
}

function _getZoomedMatrix(flycam: Flycam): Matrix4x4 {
  return M4x4.scale1(flycam.zoomStep, flycam.currentMatrix);
}

export const getUp = memoizeOne(_getUp);
export const getLeft = memoizeOne(_getLeft);
export const getPosition = memoizeOne(_getPosition);
export const getFlooredPosition = memoizeOne(_getFlooredPosition);
export const getRotation = memoizeOne(_getRotation);
export const getZoomedMatrix = memoizeOne(_getZoomedMatrix);

function _getActiveMagIndicesForLayers(state: OxalisState): { [layerName: string]: number } {
  const magIndices: { [layerName: string]: number } = {};

  for (const layer of getDataLayers(state.dataset)) {
    const maximumZoomSteps = getMaximumZoomForAllResolutionsFromStore(state, layer.name);
    const maxLogZoomStep = Math.log2(getMaxZoomStep(state.dataset));

    // Linearly search for the resolution index, for which the zoomFactor
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
export function getActiveMagIndexForLayer(state: OxalisState, layerName: string): number {
  return getActiveMagIndicesForLayers(state)[layerName];
}

/*
  Returns the resolution that is supposed to be rendered for the given layer. The return resolution
  is independent of the actually loaded data. If null is returned, the layer cannot be rendered,
  because no appropriate mag exists.
 */
export function getCurrentResolution(
  state: OxalisState,
  layerName: string,
): Vector3 | null | undefined {
  const resolutionInfo = getResolutionInfo(getLayerByName(state.dataset, layerName).resolutions);
  const magIndex = getActiveMagIndexForLayer(state, layerName);
  const existingMagIndex = resolutionInfo.getIndexOrClosestHigherIndex(magIndex);
  if (existingMagIndex == null) {
    return null;
  }
  return resolutionInfo.getResolutionByIndex(existingMagIndex);
}

function _getValidZoomRangeForUser(state: OxalisState): [number, number] {
  const maxOfLayers = _.max(
    getDataLayers(state.dataset).map((layer) => {
      const maximumZoomSteps = getMaximumZoomForAllResolutionsFromStore(state, layer.name);
      return _.last(maximumZoomSteps);
    }),
  );

  const [min, taskAwareMax] = getValidTaskZoomRange(state);
  const max = maxOfLayers != null ? Math.min(taskAwareMax, maxOfLayers) : 1;
  return [min, max];
}

export const getValidZoomRangeForUser = reuseInstanceOnEquality(_getValidZoomRangeForUser);

export function getMaxZoomValueForResolution(
  state: OxalisState,
  layerName: string,
  targetResolution: Vector3,
): number {
  const targetResolutionIdentifier = Math.max(...targetResolution);
  // Extract the max value from the range
  const maxZoom = getValidZoomRangeForResolution(state, layerName, targetResolutionIdentifier)[1];
  if (maxZoom == null) {
    // This should never happen as long as a valid target resolution is passed to this function.
    throw new Error("Zoom range could not be determined for target resolution.");
  }
  return maxZoom;
}

function getValidZoomRangeForResolution(
  state: OxalisState,
  layerName: string,
  resolutionIdentifier: number,
): Vector2 | [null, null] {
  const maximumZoomSteps = getMaximumZoomForAllResolutionsFromStore(state, layerName);
  // maximumZoomSteps is densely defined for all resolutions starting from resolution 1,1,1.
  // Therefore, we can use log2 as an index.
  const targetResolutionIndex = Math.log2(resolutionIdentifier);

  if (targetResolutionIndex > maximumZoomSteps.length) {
    return [null, null];
  }

  const max = maximumZoomSteps[targetResolutionIndex];
  const min = targetResolutionIndex > 0 ? maximumZoomSteps[targetResolutionIndex - 1] : 0;
  // Since the min of the requested range is derived from the max of the previous range,
  // we add a small delta so that the returned range is inclusive.
  return [min + Number.EPSILON, max];
}

export function getZoomValue(flycam: Flycam): number {
  return flycam.zoomStep;
}
export function getValidTaskZoomRange(
  state: OxalisState,
  respectRestriction: boolean = false,
): [number, number] {
  const defaultRange = [baseDatasetViewConfiguration.zoom.minimum, Infinity] as Vector2;
  const { resolutionRestrictions } = state.tracing.restrictions;
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
        : // If the magIdentifier is defined, but doesn't match any resolution, we default to the defaultRange values
          getValidZoomRangeForResolution(state, firstColorLayerName, magIdentifier)[idx]) ||
      defaultRange[idx]
    );
  }

  const min = getMinMax(resolutionRestrictions.min, true);
  const max = getMinMax(resolutionRestrictions.max, false);
  return [min, max];
}

export function isMagRestrictionViolated(state: OxalisState): boolean {
  const { resolutionRestrictions } = state.tracing.restrictions;
  // We use the first color layer as a heuristic to check the validity of the zoom range,
  // as we don't know to which layer a restriction is meant to be applied.
  // If the layers don't have any transforms, the layer choice doesn't matter, anyway.
  // Tracked in #6926.
  const firstColorLayerName = _.first(getColorLayers(state.dataset))?.name;
  if (!firstColorLayerName) {
    return false;
  }
  const zoomStep = getActiveMagIndexForLayer(state, firstColorLayerName);

  if (resolutionRestrictions.min != null && zoomStep < Math.log2(resolutionRestrictions.min)) {
    return true;
  }

  if (resolutionRestrictions.max != null && zoomStep > Math.log2(resolutionRestrictions.max)) {
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

export function getAreasFromState(state: OxalisState): OrthoViewMap<Area> {
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
  This function returns layers that cannot be rendered (since the current resolution is missing),
  even though they should be rendered (since they are enabled). For each layer, this method
  additionally returns whether data of this layer can be rendered by zooming in or out.
  The function takes fallback resolutions into account if renderMissingDataBlack is disabled.
 */
function _getUnrenderableLayerInfosForCurrentZoom(
  state: OxalisState,
): Array<UnrenderableLayersInfos> {
  const { dataset } = state;
  const activeMagIndices = getActiveMagIndicesForLayers(state);
  const { renderMissingDataBlack } = state.datasetConfiguration;
  const unrenderableLayers = getEnabledLayers(dataset, state.datasetConfiguration)
    .map((layer: DataLayerType) => ({
      layer,
      activeMagIdx: activeMagIndices[layer.name],
      resolutionInfo: getResolutionInfo(layer.resolutions),
    }))
    .filter(({ activeMagIdx, resolutionInfo }) => {
      const isPresent = resolutionInfo.hasIndex(activeMagIdx);

      if (isPresent) {
        // The layer exists. Thus, it is not unrenderable.
        return false;
      }

      if (renderMissingDataBlack) {
        // We already know that the layer is missing. Since `renderMissingDataBlack`
        // is enabled, the fallback resolutions don't matter. The layer cannot be
        // rendered.
        return true;
      }

      // The current resolution is missing and fallback rendering
      // is activated. Thus, check whether one of the fallback
      // zoomSteps can be rendered.
      return !_.range(1, MAX_ZOOM_STEP_DIFF + 1).some((diff) => {
        const fallbackZoomStep = activeMagIdx + diff;
        return resolutionInfo.hasIndex(fallbackZoomStep);
      });
    })
    .map<UnrenderableLayersInfos>(({ layer, resolutionInfo, activeMagIdx }) => {
      const smallerOrHigherInfo = resolutionInfo.hasSmallerAndOrHigherIndex(activeMagIdx);
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

function _getActiveResolutionInfo(state: OxalisState) {
  const enabledLayers = getEnabledLayers(state.dataset, state.datasetConfiguration);
  const activeMagIndices = getActiveMagIndicesForLayers(state);
  const activeMagIndicesOfEnabledLayers = Object.fromEntries(
    enabledLayers.map((l) => [l.name, activeMagIndices[l.name]]),
  );
  const activeMagOfEnabledLayers = Object.fromEntries(
    enabledLayers.map((l) => [
      l.name,
      getResolutionInfo(l.resolutions).getResolutionByIndex(activeMagIndices[l.name]),
    ]),
  );

  const isActiveResolutionGlobal =
    _.uniqBy(Object.values(activeMagOfEnabledLayers), (mag) => (mag != null ? mag.join("-") : null))
      .length === 1;
  let representativeResolution: Vector3 | undefined | null;
  if (isActiveResolutionGlobal) {
    representativeResolution = Object.values(activeMagOfEnabledLayers)[0];
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
    representativeResolution = _.sortBy(
      activeMagsWithSorted,
      ({ sortedMag }) => sortedMag[0],
      ({ sortedMag }) => sortedMag[1],
      ({ sortedMag }) => sortedMag[2],
    )[0]?.mag;
  }

  return {
    representativeResolution,
    activeMagIndicesOfEnabledLayers,
    activeMagOfEnabledLayers,
    isActiveResolutionGlobal,
  };
}

export const getActiveResolutionInfo = reuseInstanceOnEquality(_getActiveResolutionInfo);
