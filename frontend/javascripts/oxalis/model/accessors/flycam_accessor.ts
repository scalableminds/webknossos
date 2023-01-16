import * as THREE from "three";
import _ from "lodash";
import memoizeOne from "memoize-one";
import type { DataLayerType, Flycam, LoadingStrategy, OxalisState } from "oxalis/store";
import type { Matrix4x4 } from "libs/mjs";
import { M4x4, V3 } from "libs/mjs";
import { getAddressSpaceDimensions } from "oxalis/model/bucket_data_handling/data_rendering_logic";
import { getViewportRects } from "oxalis/model/accessors/view_mode_accessor";
import {
  getDataLayers,
  getEnabledLayers,
  getLayerByName,
  getMaxZoomStep,
  getResolutionByMax,
  getResolutionInfo,
  getResolutions,
  SmallerOrHigherInfo,
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
import determineBucketsForOrthogonal from "oxalis/model/bucket_data_handling/bucket_picker_strategies/orthogonal_bucket_picker";
import * as scaleInfo from "oxalis/model/scaleinfo";
import { reuseInstanceOnEquality } from "./accessor_helpers";
import { baseDatasetViewConfiguration } from "types/schemas/dataset_view_configuration.schema";
import { getMaxZoomStepDiff } from "oxalis/model/bucket_data_handling/loading_strategy_logic";

export const ZOOM_STEP_INTERVAL = 1.1;

function calculateTotalBucketCountForZoomLevel(
  viewMode: ViewMode,
  loadingStrategy: LoadingStrategy,
  datasetScale: Vector3,
  resolutions: Array<Vector3>,
  logZoomStep: number,
  zoomFactor: number,
  viewportRects: OrthoViewRects,
  unzoomedMatrix: Matrix4x4,
  abortLimit: number,
  initializedGpuFactor: number,
) {
  let counter = 0;
  let minPerDim: Vector3 = [Infinity, Infinity, Infinity];
  let maxPerDim: Vector3 = [0, 0, 0];

  const enqueueFunction = (bucketAddress: Vector4) => {
    minPerDim = minPerDim.map((el, index) => Math.min(el, bucketAddress[index])) as Vector3;
    maxPerDim = maxPerDim.map((el, index) => Math.max(el, bucketAddress[index])) as Vector3;
    counter++;
  };

  // Define dummy values
  const position: Vector3 = [0, 0, 0];
  const anchorPoint: Vector4 = [0, 0, 0, 0];
  const subBucketLocality: Vector3 = [1, 1, 1];
  const sphericalCapRadius = constants.DEFAULT_SPHERICAL_CAP_RADIUS;
  const areas = getAreas(viewportRects, position, zoomFactor, datasetScale);
  const dummyMatrix: Matrix4x4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const matrix = M4x4.scale1(zoomFactor, unzoomedMatrix);

  if (viewMode === constants.MODE_ARBITRARY_PLANE) {
    determineBucketsForOblique(
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
      resolutions,
      position,
      enqueueFunction,
      matrix,
      logZoomStep,
      viewportRects,
      abortLimit,
    );
  }

  const addressSpaceDimensions = getAddressSpaceDimensions(initializedGpuFactor);
  const volumeDimension = V3.sub(maxPerDim, minPerDim);

  if (
    volumeDimension[0] > addressSpaceDimensions[0] ||
    volumeDimension[1] > addressSpaceDimensions[1] ||
    volumeDimension[2] > addressSpaceDimensions[2]
  ) {
    return Infinity;
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
  datasetScale: Vector3,
  resolutions: Array<Vector3>,
  viewportRects: OrthoViewRects,
  maximumCapacity: number,
  initializedGpuFactor: number,
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
  const maxSupportedZoomValue = 2 ** MAX_SUPPORTED_MAGNIFICATION_COUNT * Math.max(...datasetScale);
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

  while (
    currentIterationCount < maximumIterationCount &&
    currentResolutionIndex < resolutions.length
  ) {
    const nextZoomValue = currentMaxZoomValue * ZOOM_STEP_INTERVAL;
    const nextCapacity = calculateTotalBucketCountForZoomLevel(
      viewMode,
      loadingStrategy,
      datasetScale,
      resolutions,
      currentResolutionIndex,
      nextZoomValue,
      viewportRects,
      unzoomedMatrix,
      // The bucket picker will stop after reaching the maximum capacity.
      // Increment the limit by one, so that rendering is still possible
      // when exactly meeting the limit.
      maximumCapacity + 1,
      initializedGpuFactor,
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
// const getMaximumZoomForAllResolutions = memoizeOne(_getMaximumZoomForAllResolutions);

export const Identity4x4 = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

// todo: make this cleaner. since the maximum zoom depends on the layer name and the right matrix,
// a memoization cache size of one doesn't work anymore. move cache to store and update explicitly?
const perLayerFnCache: Map<string, typeof _getMaximumZoomForAllResolutions> = new Map();

function getMaximumZoomForAllResolutionsFromStore(
  state: OxalisState,
  layerName: string,
): Array<number> {
  const { viewMode } = state.temporaryConfiguration;

  const layer = getLayerByName(state.dataset, layerName);
  const layerMatrix = layer.transformMatrix || Identity4x4;

  let fn = perLayerFnCache.get(layerName);
  if (fn == null) {
    fn = memoizeOne(_getMaximumZoomForAllResolutions);
    perLayerFnCache.set(layerName, fn);
  }

  return fn(
    viewMode,
    state.datasetConfiguration.loadingStrategy,
    state.dataset.dataSource.scale,
    getResolutions(state.dataset),
    getViewportRects(state),
    state.temporaryConfiguration.gpuSetup.smallestCommonBucketCapacity,
    state.temporaryConfiguration.gpuSetup.initializedGpuFactor,
    layerMatrix,
    // Theoretically, the following parameter should be state.flycam.currentMatrix.
    // However, that matrix changes on each move and for the ortho mode, the difference
    // is only a translation which can be ignored for gauging the maximum zoom here.
    // Todo: This differs for oblique and flight mode where the matrix can also cause
    // a rotation.
    // Todo: Maybe change the strategy to store/cache these values directly in the store and only
    // update them when critical actions are triggered?
    Identity4x4,
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

export function getActiveMagIndexForLayer(state: OxalisState, layerName: string): number {
  return getActiveMagIndicesForLayers(state)[layerName];
}

export function getCurrentResolution(state: OxalisState, layerName: string): Vector3 {
  const resolutions = getResolutions(state.dataset);
  const logZoomStep = getActiveMagIndexForLayer(state, layerName);
  return resolutions[logZoomStep] || [1, 1, 1];
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
  // Extract the max value from the range
  return getValidZoomRangeForResolution(state, layerName, targetResolution)[1];
}

function getValidZoomRangeForResolution(
  state: OxalisState,
  layerName: string,
  targetResolution: Vector3,
): Vector2 {
  const maximumZoomSteps = getMaximumZoomForAllResolutionsFromStore(state, layerName);
  const resolutions = getResolutions(state.dataset);

  const targetResolutionIndex = _.findIndex(resolutions, (resolution) =>
    _.isEqual(resolution, targetResolution),
  );

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

  return defaultRange;

  // todo: the resolution restrictions need to be stored per layer (backend + frontend).
  // if (!respectRestriction) {
  //   return defaultRange;
  // }

  // function getMinMax(value: number | undefined, isMin: boolean) {
  //   const idx = isMin ? 0 : 1;
  //   return (
  //     (value == null
  //       ? defaultRange[idx]
  //       : // If the value is defined, but doesn't match any resolution, we default to the defaultRange values
  //         getValidZoomRangeForResolution(state, getResolutionByMax(state.dataset, value))[idx]) ||
  //     defaultRange[idx]
  //   );
  // }

  // const min = getMinMax(resolutionRestrictions.min, true);
  // const max = getMinMax(resolutionRestrictions.max, false);
  // return [min, max];
}
export function isMagRestrictionViolated(state: OxalisState): boolean {
  const { resolutionRestrictions } = state.tracing.restrictions;
  // todo: the resolution restrictions need to be stored per layer (backend + frontend).
  const zoomStep = 0; // getRequestLogZoomStep(state);

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
  datasetScale: Vector3,
  planeId: OrthoView,
): Area {
  const [u, v] = Dimensions.getIndices(planeId);
  const [viewportWidthHalf, viewportHeightHalf] = getPlaneExtentInVoxel(
    rects,
    zoomStep,
    planeId,
  ).map((el) => el / 2);
  const baseVoxelFactors = scaleInfo.getBaseVoxelFactors(datasetScale);
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
  datasetScale: Vector3,
): OrthoViewMap<Area> {
  // @ts-expect-error ts-migrate(2741) FIXME: Property 'TDView' is missing in type '{ PLANE_XY: ... Remove this comment to see the full error message
  return {
    [OrthoViews.PLANE_XY]: getArea(rects, position, zoomStep, datasetScale, OrthoViews.PLANE_XY),
    [OrthoViews.PLANE_XZ]: getArea(rects, position, zoomStep, datasetScale, OrthoViews.PLANE_XZ),
    [OrthoViews.PLANE_YZ]: getArea(rects, position, zoomStep, datasetScale, OrthoViews.PLANE_YZ),
  };
}

export function getAreasFromState(state: OxalisState): OrthoViewMap<Area> {
  const position = getPosition(state.flycam);
  const rects = getViewportRects(state);
  const { zoomStep } = state.flycam;
  const datasetScale = state.dataset.dataSource.scale;
  return getAreas(rects, position, zoomStep, datasetScale);
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
  const maxZoomStepDiff = getMaxZoomStepDiff(state.datasetConfiguration.loadingStrategy);
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
      return !_.range(1, maxZoomStepDiff + 1).some((diff) => {
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
