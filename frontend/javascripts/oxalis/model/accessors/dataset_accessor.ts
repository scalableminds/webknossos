import Maybe from "data.maybe";
import _ from "lodash";
import memoizeOne from "memoize-one";
import type {
  APIAllowedMode,
  APIDataset,
  APIMaybeUnimportedDataset,
  APISegmentationLayer,
  ElementClass,
} from "types/api_flow_types";
import type {
  Settings,
  DataLayerType,
  DatasetConfiguration,
  BoundingBoxObject,
  OxalisState,
  ActiveMappingInfo,
} from "oxalis/store";
import ErrorHandling from "libs/error_handling";
import type { Vector3, ViewMode } from "oxalis/constants";
import constants, { ViewModeValues, Vector3Indicies, MappingStatusEnum } from "oxalis/constants";
import { aggregateBoundingBox, map3 } from "libs/utils";
import { formatExtentWithLength, formatNumberToLength } from "libs/format_utils";
import messages from "messages";
import { DataLayer } from "types/schemas/datasource.types";
import BoundingBox from "../bucket_data_handling/bounding_box";
export type ResolutionsMap = Map<number, Vector3>;
export type SmallerOrHigherInfo = {
  smaller: boolean;
  higher: boolean;
};

function maxValue(array: Array<number>): number {
  const value = _.max(array);
  if (value == null) {
    throw Error(`Max of empty array: ${array}`);
  }
  return value;
}

function minValue(array: Array<number>): number {
  const value = _.min(array);
  if (value == null) {
    throw Error(`Min of empty array: ${array}`);
  }
  return value;
}

export class ResolutionInfo {
  readonly resolutions: ReadonlyArray<Vector3>;
  readonly resolutionMap: ReadonlyMap<number, Vector3>;

  constructor(resolutions: Array<Vector3>) {
    this.resolutions = resolutions;
    this.resolutionMap = this._buildResolutionMap();
  }

  _buildResolutionMap() {
    // Each resolution entry can be characterized by it's greatest resolution dimension.
    // E.g., the resolution array [[1, 1, 1], [2, 2, 1], [4, 4, 2]] defines that
    // a zoomstep of 2 corresponds to the resolution [2, 2, 1] (and not [4, 4, 2]).
    // Therefore, the largest dim for each resolution has to be unique across all resolutions.
    // This function creates a map which maps from powerOfTwo (2**index) to resolution.
    const { resolutions } = this;
    const resolutionMap = new Map();

    if (resolutions.length !== _.uniq(resolutions.map(maxValue)).length) {
      throw new Error("Max dimension in resolutions is not unique.");
    }

    for (const resolution of resolutions) {
      resolutionMap.set(maxValue(resolution), resolution);
    }
    return resolutionMap;
  }

  getDenseResolutions = memoizeOne(() => convertToDenseResolution(this.getResolutionList()));

  getResolutionList = memoizeOne(() => Array.from(this.resolutionMap.values()));

  getResolutionsWithIndices(): Array<[number, Vector3]> {
    return _.sortBy(
      Array.from(this.resolutionMap.entries()).map((entry) => {
        const [powerOfTwo, resolution] = entry;
        const resolutionIndex = Math.log2(powerOfTwo);
        return [resolutionIndex, resolution];
      }), // Sort by resolutionIndex
      (tuple) => tuple[0],
    );
  }

  indexToPowerOf2(index: number): number {
    return 2 ** index;
  }

  hasIndex(index: number): boolean {
    const powerOfTwo = this.indexToPowerOf2(index);
    return this.resolutionMap.has(powerOfTwo);
  }

  getResolutionByIndex(index: number): Vector3 | null | undefined {
    const powerOfTwo = this.indexToPowerOf2(index);
    return this.getResolutionByPowerOf2(powerOfTwo);
  }

  getResolutionByIndexOrThrow(index: number): Vector3 {
    const resolution = this.getResolutionByIndex(index);

    if (!resolution) {
      throw new Error(`Magnification with index ${index} does not exist.`);
    }

    return resolution;
  }

  getIndexByResolution(resolution: Vector3): number {
    const index = Math.log2(Math.max(...resolution));

    // Assert that the index exists and that the resolution at that index
    // equals the resolution argument
    const resolutionMaybe = this.getResolutionByIndex(index);
    if (!_.isEqual(resolution, resolutionMaybe)) {
      throw new Error(
        `Magnification ${resolution} with index ${index} is not equal to existing magnification at that index: ${resolutionMaybe}.`,
      );
    }
    return index;
  }

  getResolutionByIndexWithFallback(
    index: number,
    fallbackResolutionInfo: ResolutionInfo | null | undefined,
  ): Vector3 {
    let resolutionMaybe = this.getResolutionByIndex(index);

    if (resolutionMaybe) {
      return resolutionMaybe;
    }

    resolutionMaybe =
      fallbackResolutionInfo != null ? fallbackResolutionInfo.getResolutionByIndex(index) : null;

    if (resolutionMaybe) {
      return resolutionMaybe;
    }

    if (index === 0) {
      // If the index is 0, only mag 1-1-1 can be meant.
      return [1, 1, 1];
    }

    throw new Error(`Magnification could not be determined for index ${index}`);
  }

  getResolutionByPowerOf2(powerOfTwo: number): Vector3 | null | undefined {
    return this.resolutionMap.get(powerOfTwo);
  }

  getHighestResolutionPowerOf2(): number {
    return maxValue(Array.from(this.resolutionMap.keys()));
  }

  getLowestResolutionPowerOf2(): number {
    return minValue(Array.from(this.resolutionMap.keys()));
  }

  getHighestResolutionIndex(): number {
    return Math.log2(this.getHighestResolutionPowerOf2());
  }

  getLowestResolutionIndex(): number {
    return Math.log2(this.getLowestResolutionPowerOf2());
  }

  getHighestResolution(): Vector3 {
    // @ts-ignore
    return this.getResolutionByPowerOf2(this.getHighestResolutionPowerOf2());
  }

  getLowestResolution(): Vector3 {
    // @ts-ignore
    return this.getResolutionByPowerOf2(this.getLowestResolutionPowerOf2());
  }

  getAllIndices(): Array<number> {
    return this.getResolutionsWithIndices().map((entry) => entry[0]);
  }

  getClosestExistingIndex(index: number, errorMessage: string | null = null): number {
    if (this.hasIndex(index)) {
      return index;
    }

    const indices = this.getAllIndices();
    const indicesWithDistances = indices.map((_index) => {
      const distance = index - _index;

      if (distance >= 0) {
        // The candidate _index is smaller than the requested index.
        // Since webKnossos only supports rendering from higher mags,
        // when a mag is missing, we want to prioritize "higher" mags
        // when looking for a substitute. Therefore, we artificially
        // downrank the smaller mag _index.
        return [_index, distance + 0.5];
      } else {
        return [_index, Math.abs(distance)];
      }
    });

    const bestIndexWithDistance = _.head(_.sortBy(indicesWithDistances, (entry) => entry[1]));
    if (bestIndexWithDistance == null) {
      throw new Error(errorMessage || "Couldn't find any resolution.");
    }

    return bestIndexWithDistance[0];
  }

  hasSmallerAndOrHigherIndex(index: number): SmallerOrHigherInfo {
    const indices = this.getAllIndices();
    const hasSmallOrHigher = {
      smaller: false,
      higher: false,
    };

    for (const currentIndex of indices) {
      if (currentIndex < index) {
        hasSmallOrHigher.smaller = true;
      } else if (currentIndex > index) {
        hasSmallOrHigher.higher = true;
      }
    }

    return hasSmallOrHigher;
  }

  getIndexOrClosestHigherIndex(requestedIndex: number): number | null | undefined {
    if (this.hasIndex(requestedIndex)) {
      return requestedIndex;
    }

    const indices = this.getResolutionsWithIndices().map((entry) => entry[0]);

    for (const index of indices) {
      if (index > requestedIndex) {
        // Return the first existing index which is higher than the requestedIndex
        return index;
      }
    }

    return null;
  }
}

function _getResolutionInfo(resolutions: Array<Vector3>): ResolutionInfo {
  return new ResolutionInfo(resolutions);
}

// Don't use memoizeOne here, since we want to cache the resolutions for all layers
// (which are not that many).
export const getResolutionInfo = _.memoize(_getResolutionInfo);
export function getResolutionUnion(
  dataset: APIDataset,
  shouldThrow: boolean = false,
): Array<Vector3> {
  const resolutionUnionDict: { [key: number]: Vector3 } = {};

  for (const layer of dataset.dataSource.dataLayers) {
    for (const resolution of layer.resolutions) {
      const key = maxValue(resolution);

      if (resolutionUnionDict[key] == null) {
        resolutionUnionDict[key] = resolution;
      } else if (_.isEqual(resolutionUnionDict[key], resolution)) {
        // the same resolution was already picked up
      } else if (shouldThrow) {
        throw new Error(
          `The resolutions of the different layers don't match. ${resolutionUnionDict[key].join(
            "-",
          )} != ${resolution.join("-")}.`,
        );
      } else {
        // The resolutions don't match, but shouldThrow is false
      }
    }
  }

  return _.chain(resolutionUnionDict).values().sortBy(maxValue).valueOf();
}
export function convertToDenseResolution(resolutions: Array<Vector3>): Array<Vector3> {
  // Each resolution entry can be characterized by it's greatest resolution dimension.
  // E.g., the resolution array [[1, 1, 1], [2, 2, 1], [4, 4, 2]] defines that
  // a log zoomstep of 2 corresponds to the resolution [2, 2, 1] (and not [4, 4, 2]).
  // Therefore, the largest dim for each resolution has to be unique across all resolutions.
  // This function returns an array of resolutions, for which each index will
  // hold a resolution with highest_dim === 2**index and where resolutions are monotonously increasing.

  if (resolutions.length !== _.uniq(resolutions.map(maxValue)).length) {
    throw new Error("Max dimension in resolutions is not unique.");
  }

  const maxResolution = Math.log2(maxValue(resolutions.map((v) => maxValue(v))));

  const resolutionsLookUp = _.keyBy(resolutions, maxValue);

  const maxResPower = 2 ** maxResolution;
  let lastResolution = [maxResPower, maxResPower, maxResPower];
  // @ts-expect-error ts-migrate(2322) FIXME: Type 'number[][]' is not assignable to type 'Vecto... Remove this comment to see the full error message
  return _.range(maxResolution, -1, -1)
    .map((exp) => {
      const resPower = 2 ** exp;
      // If the resolution does not exist, use the component-wise minimum of the next-higher
      // resolution and an isotropic fallback resolution. Otherwise for anisotropic resolutions,
      // the dense resolutions wouldn't be monotonously increasing.
      const fallback = map3((i) => Math.min(lastResolution[i], resPower), [0, 1, 2]);
      lastResolution = resolutionsLookUp[resPower] || fallback;
      return lastResolution;
    })
    .reverse();
}

function _getResolutions(dataset: APIDataset): Vector3[] {
  // Different layers can have different resolutions. At the moment,
  // mismatching resolutions will result in undefined behavior (rather than
  // causing a hard error). During the model initialization, an error message
  // will be shown, though.
  // In the long term, getResolutions should not be used anymore.
  // Instead, all the code should use the ResolutionInfo class which represents
  // exactly which resolutions exist per layer.
  return convertToDenseResolution(getResolutionUnion(dataset));
}

// _getResolutions itself is not very performance intensive, but other functions which rely
// on the returned resolutions are. To avoid busting memoization caches (which rely on references),
// we memoize _getResolutions, as well.
export const getResolutions = memoizeOne(_getResolutions);
export function getDatasetResolutionInfo(dataset: APIDataset): ResolutionInfo {
  return getResolutionInfo(getResolutions(dataset));
}

function _getMaxZoomStep(maybeDataset: APIDataset | null | undefined): number {
  const minimumZoomStepCount = 1;
  const maxZoomstep = Maybe.fromNullable(maybeDataset)
    .map((dataset) =>
      Math.max(
        minimumZoomStepCount,
        Math.max(0, ...getResolutions(dataset).map((r) => Math.max(r[0], r[1], r[2]))),
      ),
    )
    .getOrElse(2 ** (minimumZoomStepCount - 1));
  return maxZoomstep;
}

export const getMaxZoomStep = memoizeOne(_getMaxZoomStep);
export function getDataLayers(dataset: APIDataset): DataLayerType[] {
  return dataset.dataSource.dataLayers;
}

function _getResolutionInfoOfVisibleSegmentationLayer(state: OxalisState): ResolutionInfo {
  const segmentationLayer = getVisibleSegmentationLayer(state);

  if (!segmentationLayer) {
    return new ResolutionInfo([]);
  }

  return getResolutionInfo(segmentationLayer.resolutions);
}

export const getResolutionInfoOfVisibleSegmentationLayer = memoizeOne(
  _getResolutionInfoOfVisibleSegmentationLayer,
);
export function getLayerByName(dataset: APIDataset, layerName: string): DataLayerType {
  const dataLayers = getDataLayers(dataset);
  const hasUniqueNames = _.uniqBy(dataLayers, "name").length === dataLayers.length;
  ErrorHandling.assert(hasUniqueNames, messages["dataset.unique_layer_names"]);
  const layer = dataLayers.find((l) => l.name === layerName);

  if (!layer) {
    throw new Error(`Layer "${layerName}" not found`);
  }

  return layer;
}
export function getLayerByNameOrFallbackName(
  dataset: APIDataset,
  layerName: string,
): DataLayerType {
  const dataLayers = getDataLayers(dataset);
  const hasUniqueNames = _.uniqBy(dataLayers, "name").length === dataLayers.length;
  ErrorHandling.assert(hasUniqueNames, messages["dataset.unique_layer_names"]);
  const layer = dataLayers.find(
    // @ts-expect-error ts-migrate(2339) FIXME: Property 'fallbackLayer' does not exist on type 'A... Remove this comment to see the full error message
    (l) => l.name === layerName || (l.fallbackLayer && l.fallbackLayer === layerName),
  );

  if (!layer) {
    throw new Error(`Layer "${layerName}" not found`);
  }

  return layer;
}
export function getSegmentationLayerByName(
  dataset: APIDataset,
  layerName: string,
): APISegmentationLayer {
  const layer = getLayerByName(dataset, layerName);

  if (layer.category !== "segmentation") {
    throw new Error(`The requested layer with name ${layerName} is not a segmentation layer.`);
  }

  return layer;
}
export function getSegmentationLayerByNameOrFallbackName(
  dataset: APIDataset,
  layerName: string,
): APISegmentationLayer {
  const layer = getLayerByNameOrFallbackName(dataset, layerName);

  if (layer.category !== "segmentation") {
    throw new Error(`The requested layer with name ${layerName} is not a segmentation layer.`);
  }

  return layer;
}
export function getMappings(dataset: APIDataset, layerName: string): string[] {
  // @ts-expect-error ts-migrate(2339) FIXME: Property 'mappings' does not exist on type 'APIDat... Remove this comment to see the full error message
  return getLayerByName(dataset, layerName).mappings || [];
}
export function isRgb(dataset: APIDataset, layerName: string): boolean {
  return (
    getLayerByName(dataset, layerName).category === "color" &&
    getByteCount(dataset, layerName) === 3
  );
}
export function getByteCountFromLayer(layerInfo: DataLayerType): number {
  return getBitDepth(layerInfo) / 8;
}
export function getByteCount(dataset: APIDataset, layerName: string): number {
  return getByteCountFromLayer(getLayerByName(dataset, layerName));
}
export function getElementClass(dataset: APIDataset, layerName: string): ElementClass {
  return getLayerByName(dataset, layerName).elementClass;
}
export function getDefaultIntensityRangeOfLayer(
  dataset: APIDataset,
  layerName: string,
): [number, number] {
  const maxFloatValue = 3.40282347e38;
  // eslint-disable-next-line @typescript-eslint/no-loss-of-precision
  const maxDoubleValue = 1.79769313486232e308;
  const elementClass = getElementClass(dataset, layerName);

  switch (elementClass) {
    case "uint8":
    case "uint24":
      // Since uint24 layers are multi-channel, their intensity ranges are equal to uint8
      return [0, 2 ** 8 - 1];

    case "uint16":
      return [0, 2 ** 16 - 1];

    case "uint32":
      return [0, 2 ** 32 - 1];

    case "uint64":
      return [0, 2 ** 64 - 1];

    // We do not fully support signed int data;
    case "int16":
      return [0, 2 ** 15 - 1];

    case "int32":
      return [0, 2 ** 31 - 1];

    case "int64":
      return [0, 2 ** 63 - 1];

    case "float":
      return [0, maxFloatValue];

    case "double":
      return [0, maxDoubleValue];

    default:
      return [0, 255];
  }
}
export type Boundary = {
  lowerBoundary: Vector3;
  upperBoundary: Vector3;
};

/*
   The returned Boundary denotes a half-open interval. This means that the lowerBoundary
   is included in the bounding box and the upper boundary is *not* included.
*/
export function getLayerBoundaries(dataset: APIDataset, layerName: string): Boundary {
  const { topLeft, width, height, depth } = getLayerByName(dataset, layerName).boundingBox;
  const lowerBoundary = topLeft;
  const upperBoundary = [topLeft[0] + width, topLeft[1] + height, topLeft[2] + depth] as Vector3;
  return {
    lowerBoundary,
    upperBoundary,
  };
}

export function getLayerBoundingBox(dataset: APIDataset, layerName: string): BoundingBox {
  const { lowerBoundary, upperBoundary } = getLayerBoundaries(dataset, layerName);
  return new BoundingBox({
    min: lowerBoundary,
    max: upperBoundary,
  });
}

export function getBoundaries(dataset: APIDataset): Boundary {
  const lowerBoundary = [Infinity, Infinity, Infinity];
  const upperBoundary = [-Infinity, -Infinity, -Infinity];
  const layers = getDataLayers(dataset);

  for (const dataLayer of layers) {
    const layerBoundaries = getLayerBoundaries(dataset, dataLayer.name);

    for (const i of Vector3Indicies) {
      lowerBoundary[i] = Math.min(lowerBoundary[i], layerBoundaries.lowerBoundary[i]);
      upperBoundary[i] = Math.max(upperBoundary[i], layerBoundaries.upperBoundary[i]);
    }
  }

  return {
    // @ts-expect-error ts-migrate(2322) FIXME: Type 'number[]' is not assignable to type 'Vector3... Remove this comment to see the full error message
    lowerBoundary,
    // @ts-expect-error ts-migrate(2322) FIXME: Type 'number[]' is not assignable to type 'Vector3... Remove this comment to see the full error message
    upperBoundary,
  };
}
export function getDatasetCenter(dataset: APIDataset): Vector3 {
  const { lowerBoundary, upperBoundary } = getBoundaries(dataset);
  return [
    (lowerBoundary[0] + upperBoundary[0]) / 2,
    (lowerBoundary[1] + upperBoundary[1]) / 2,
    (lowerBoundary[2] + upperBoundary[2]) / 2,
  ];
}
export function getDatasetExtentInVoxel(dataset: APIDataset) {
  const datasetLayers = dataset.dataSource.dataLayers;
  const allBoundingBoxes = datasetLayers.map((layer) => layer.boundingBox);
  const unifiedBoundingBoxes = aggregateBoundingBox(allBoundingBoxes);
  const { min, max } = unifiedBoundingBoxes;
  const extent = {
    topLeft: min,
    width: max[0] - min[0],
    height: max[1] - min[1],
    depth: max[2] - min[2],
    min,
    max,
  };
  return extent;
}
export function getDatasetExtentInLength(dataset: APIDataset): BoundingBoxObject {
  const extentInVoxel = getDatasetExtentInVoxel(dataset);
  const { scale } = dataset.dataSource;
  const topLeft = extentInVoxel.topLeft.map((val, index) => val * scale[index]) as any as Vector3;
  const extent = {
    topLeft,
    width: extentInVoxel.width * scale[0],
    height: extentInVoxel.height * scale[1],
    depth: extentInVoxel.depth * scale[2],
  };
  return extent;
}
export function getDatasetExtentAsString(
  dataset: APIMaybeUnimportedDataset,
  inVoxel: boolean = true,
): string {
  if (!dataset.isActive) {
    return "";
  }

  if (inVoxel) {
    const extentInVoxel = getDatasetExtentInVoxel(dataset);
    return `${formatExtentWithLength(extentInVoxel, (x) => `${x}`)} voxel`;
  }

  const extent = getDatasetExtentInLength(dataset);
  return formatExtentWithLength(extent, formatNumberToLength);
}
export function determineAllowedModes(
  dataset: APIDataset,
  settings?: Settings,
): {
  preferredMode: APIAllowedMode | null | undefined;
  allowedModes: Array<APIAllowedMode>;
} {
  // The order of allowedModes should be independent from the server and instead be similar to ViewModeValues
  const allowedModes = settings
    ? _.intersection(ViewModeValues, settings.allowedModes)
    : ViewModeValues;
  let preferredMode = null;

  if (settings?.preferredMode != null) {
    const modeId = settings.preferredMode;

    if (allowedModes.includes(modeId)) {
      preferredMode = modeId;
    }
  }

  return {
    preferredMode,
    allowedModes,
  };
}
export function getBitDepth(layerInfo: DataLayer | DataLayerType): number {
  switch (layerInfo.elementClass) {
    case "uint8":
      return 8;

    case "uint16":
      return 16;

    case "uint24":
      return 24;

    case "uint32":
      return 32;

    case "uint64":
      return 64;

    case "float":
      return 32;

    case "double":
      return 64;

    case "int8":
      return 8;

    case "int16":
      return 16;

    case "int32":
      return 32;

    case "int64":
      return 64;

    default:
      throw new Error("Unknown element class");
  }
}
export function isElementClassSupported(layerInfo: DataLayerType): boolean {
  switch (layerInfo.elementClass) {
    case "uint8":
    case "uint16":
    case "uint24":
    case "uint32":
    case "int8":
    case "int16":
    case "int32":
    case "float":
    case "uint64":
      return true;

    case "double":
    case "int64":
    default:
      return false;
  }
}
export function isSegmentationLayer(dataset: APIDataset, layerName: string): boolean {
  return getLayerByName(dataset, layerName).category === "segmentation";
}
export function isColorLayer(dataset: APIDataset, layerName: string): boolean {
  return getLayerByName(dataset, layerName).category === "color";
}
export function getVisibleSegmentationLayer(
  state: OxalisState,
): APISegmentationLayer | null | undefined {
  const visibleSegmentationLayers = getVisibleSegmentationLayers(state);

  if (visibleSegmentationLayers.length > 0) {
    return visibleSegmentationLayers[0];
  }

  return null;
}
export function getVisibleOrLastSegmentationLayer(
  state: OxalisState,
): APISegmentationLayer | null | undefined {
  const visibleSegmentationLayer = getVisibleSegmentationLayer(state);
  if (visibleSegmentationLayer != null) return visibleSegmentationLayer;
  const lastVisibleSegmentationLayerName =
    state.temporaryConfiguration.lastVisibleSegmentationLayerName;

  if (lastVisibleSegmentationLayerName != null) {
    return getSegmentationLayerByName(state.dataset, lastVisibleSegmentationLayerName);
  }

  return null;
}

export function hasVisibleUint64Segmentation(state: OxalisState) {
  const segmentationLayer = getVisibleSegmentationLayer(state);
  return segmentationLayer ? segmentationLayer.elementClass === "uint64" : false;
}

export function getVisibleSegmentationLayers(state: OxalisState): Array<APISegmentationLayer> {
  const { datasetConfiguration } = state;
  const { viewMode } = state.temporaryConfiguration;
  const segmentationLayers = getSegmentationLayers(state.dataset);
  const visibleSegmentationLayers = segmentationLayers.filter((layer) =>
    isLayerVisible(state.dataset, layer.name, datasetConfiguration, viewMode),
  );
  return visibleSegmentationLayers;
}

export function getSegmentationLayerWithMappingSupport(
  state: OxalisState,
): APISegmentationLayer | null | undefined {
  // Currently, webKnossos only supports one active mapping at a given time. The UI should ensure
  // that not more than one mapping is enabled (currently, this is achieved by only allowing one
  // visible segmentation layer, anyway).
  const visibleSegmentationLayers = getVisibleSegmentationLayers(state);
  // Find the visible layer with an enabled or activating mapping
  const layersWithoutDisabledMapping = visibleSegmentationLayers.filter((layer) => {
    const mappingInfo = state.temporaryConfiguration.activeMappingByLayer[layer.name];
    return mappingInfo && mappingInfo.mappingStatus !== MappingStatusEnum.DISABLED;
  });

  if (layersWithoutDisabledMapping.length > 0) {
    return layersWithoutDisabledMapping[0];
  }

  return null;
}

export function getFirstSegmentationLayer(
  dataset: APIMaybeUnimportedDataset,
): APISegmentationLayer | null | undefined {
  if (!dataset.isActive) {
    return null;
  }

  const segmentationLayers = getSegmentationLayers(dataset);

  if (segmentationLayers.length > 0) {
    return segmentationLayers[0];
  }

  return null;
}
export function getSegmentationLayers(
  dataset: APIMaybeUnimportedDataset,
): Array<APISegmentationLayer> {
  if (!dataset.isActive) {
    return [];
  }

  const segmentationLayers = dataset.dataSource.dataLayers.filter((dataLayer) =>
    isSegmentationLayer(dataset, dataLayer.name),
  ) as APISegmentationLayer[];
  return segmentationLayers;
}
export function hasSegmentation(dataset: APIDataset): boolean {
  return getSegmentationLayers(dataset).length > 0;
}
export function doesSupportVolumeWithFallback(
  dataset: APIMaybeUnimportedDataset,
  segmentationLayer: APISegmentationLayer | null | undefined,
): boolean {
  if (!dataset.isActive) {
    return false;
  }

  if (!segmentationLayer) {
    return false;
  }

  return true;
}
export function getColorLayers(dataset: APIDataset): Array<DataLayerType> {
  return dataset.dataSource.dataLayers.filter((dataLayer) => isColorLayer(dataset, dataLayer.name));
}
export function getEnabledLayers(
  dataset: APIDataset,
  datasetConfiguration: DatasetConfiguration,
  options: {
    invert?: boolean;
  } = {},
): Array<DataLayerType> {
  const dataLayers = dataset.dataSource.dataLayers;
  const layerSettings = datasetConfiguration.layers;
  return dataLayers.filter((layer) => {
    const settings = layerSettings[layer.name];

    if (settings == null) {
      return false;
    }

    return settings.isDisabled === Boolean(options.invert);
  });
}

export function getEnabledColorLayers(
  dataset: APIDataset,
  datasetConfiguration: DatasetConfiguration,
) {
  const enabledLayers = getEnabledLayers(dataset, datasetConfiguration);
  return enabledLayers.filter((layer) => isColorLayer(dataset, layer.name));
}

export function getThumbnailURL(dataset: APIDataset): string {
  const datasetName = dataset.name;
  const organizationName = dataset.owningOrganization;
  const layers = dataset.dataSource.dataLayers;

  const colorLayer = _.find(layers, {
    category: "color",
  });

  if (colorLayer) {
    return `/api/datasets/${organizationName}/${datasetName}/layers/${colorLayer.name}/thumbnail`;
  }

  return "";
}
export function getSegmentationThumbnailURL(dataset: APIDataset): string {
  const datasetName = dataset.name;
  const organizationName = dataset.owningOrganization;
  const segmentationLayer = getFirstSegmentationLayer(dataset);

  if (segmentationLayer) {
    return `/api/datasets/${organizationName}/${datasetName}/layers/${segmentationLayer.name}/thumbnail`;
  }

  return "";
}

function _keyResolutionsByMax(dataset: APIDataset): Record<number, Vector3> {
  const resolutions = getResolutions(dataset);
  return _.keyBy(resolutions, (res) => Math.max(...res));
}

const keyResolutionsByMax = memoizeOne(_keyResolutionsByMax);
export function getResolutionByMax(dataset: APIDataset, maxDim: number): Vector3 {
  const keyedResolutionsByMax = keyResolutionsByMax(dataset);
  return keyedResolutionsByMax[maxDim];
}
export function isLayerVisible(
  dataset: APIDataset,
  layerName: string,
  datasetConfiguration: DatasetConfiguration,
  viewMode: ViewMode,
): boolean {
  const layerConfig = datasetConfiguration.layers[layerName];

  if (!layerConfig) {
    return false;
  }

  const isArbitraryMode = constants.MODES_ARBITRARY.includes(viewMode);
  const isHiddenBecauseOfArbitraryMode = isArbitraryMode && isSegmentationLayer(dataset, layerName);
  return !layerConfig.isDisabled && layerConfig.alpha > 0 && !isHiddenBecauseOfArbitraryMode;
}
export function is2dDataset(dataset: APIDataset): boolean {
  // An empty dataset (e.g., depth == 0), should not be considered as 2D.
  // This avoids that the empty dummy dataset is rendered with a 2D layout
  // which is usually switched to the 3D layout after the proper dataset has
  // been loaded.
  return getDatasetExtentInVoxel(dataset).depth === 1;
}
const dummyMapping = {
  mappingName: null,
  mapping: null,
  mappingKeys: null,
  mappingColors: null,
  hideUnmappedIds: false,
  mappingStatus: MappingStatusEnum.DISABLED,
  mappingSize: 0,
  mappingType: "JSON",
};
export function getMappingInfo(
  activeMappingInfos: Record<string, ActiveMappingInfo>,
  layerName: string | null | undefined,
): ActiveMappingInfo {
  if (layerName != null && activeMappingInfos[layerName]) {
    return activeMappingInfos[layerName];
  }

  // Return a dummy object (this mirrors webKnossos' behavior before the support of
  // multiple segmentation layers)
  // @ts-expect-error ts-migrate(2322) FIXME: Type '{ mappingName: null; mapping: null; mappingK... Remove this comment to see the full error message
  return dummyMapping;
}
export function getMappingInfoForSupportedLayer(state: OxalisState): ActiveMappingInfo {
  const layer = getSegmentationLayerWithMappingSupport(state);
  return getMappingInfo(
    state.temporaryConfiguration.activeMappingByLayer,
    layer ? layer.name : null,
  );
}
