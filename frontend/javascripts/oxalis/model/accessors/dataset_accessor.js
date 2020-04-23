// @flow
import Maybe from "data.maybe";
import _ from "lodash";
import memoizeOne from "memoize-one";

import type {
  APIAllowedMode,
  APIDataset,
  APIMaybeUnimportedDataset,
  APISegmentationLayer,
  ElementClass,
} from "admin/api_flow_types";
import type { Settings, DataLayerType, DatasetConfiguration } from "oxalis/store";
import ErrorHandling from "libs/error_handling";
import constants, { ViewModeValues, type Vector3, Vector3Indicies } from "oxalis/constants";
import { aggregateBoundingBox } from "libs/utils";
import { formatExtentWithLength, formatNumberToLength } from "libs/format_utils";
import messages from "messages";

export function getMostExtensiveResolutions(dataset: APIDataset): Array<Vector3> {
  return _.chain(dataset.dataSource.dataLayers)
    .map(dataLayer => dataLayer.resolutions)
    .sortBy(resolutions => resolutions.length)
    .last()
    .valueOf();
}

function _getResolutions(dataset: APIDataset): Vector3[] {
  // Different layers can have different resolutions. At the moment,
  // unequal resolutions will result in undefined behavior.
  // However, if resolutions are subset of each other, everything should be fine.
  // For that case, returning the longest resolutions array should suffice

  const mostExtensiveResolutions = getMostExtensiveResolutions(dataset);
  if (!mostExtensiveResolutions) {
    return [];
  }

  return mostExtensiveResolutions;
}

// _getResolutions itself is not very performance intensive, but other functions which rely
// on the returned resolutions are. To avoid busting memoization caches (which rely on references),
// we memoize _getResolutions, as well.
export const getResolutions = memoizeOne(_getResolutions);

function _getMaxZoomStep(maybeDataset: ?APIDataset): number {
  const minimumZoomStepCount = 1;
  const maxZoomstep = Maybe.fromNullable(maybeDataset)
    .map(dataset =>
      Math.max(
        minimumZoomStepCount,
        Math.max(0, ...getResolutions(dataset).map(r => Math.max(r[0], r[1], r[2]))),
      ),
    )
    .getOrElse(2 ** (minimumZoomStepCount - 1));
  return maxZoomstep;
}

export const getMaxZoomStep = memoizeOne(_getMaxZoomStep);

export function getDataLayers(dataset: APIDataset): DataLayerType[] {
  return dataset.dataSource.dataLayers;
}

export function getLayerByName(dataset: APIDataset, layerName: string): DataLayerType {
  const dataLayers = getDataLayers(dataset);
  const hasUniqueNames = _.uniqBy(dataLayers, "name").length === dataLayers.length;
  ErrorHandling.assert(hasUniqueNames, messages["dataset.unique_layer_names"]);

  const layer = dataLayers.find(l => l.name === layerName);
  if (!layer) {
    throw new Error(`Layer "${layerName}" not found`);
  }
  return layer;
}

export function getMappings(dataset: APIDataset, layerName: string): string[] {
  return getLayerByName(dataset, layerName).mappings || [];
}

export function isRgb(dataset: APIDataset, layerName: string): boolean {
  return (
    getLayerByName(dataset, layerName).category === "color" &&
    getByteCount(dataset, layerName) === 3
  );
}

export function getByteCountFromLayer(layerInfo: DataLayerType): number {
  return getBitDepth(layerInfo) >> 3;
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

export type Boundary = { lowerBoundary: Vector3, upperBoundary: Vector3 };

export function getLayerBoundaries(dataset: APIDataset, layerName: string): Boundary {
  const { topLeft, width, height, depth } = getLayerByName(dataset, layerName).boundingBox;
  const lowerBoundary = topLeft;
  const upperBoundary = [topLeft[0] + width, topLeft[1] + height, topLeft[2] + depth];

  return { lowerBoundary, upperBoundary };
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

  return { lowerBoundary, upperBoundary };
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
  const allBoundingBoxes = datasetLayers.map(layer => layer.boundingBox);
  const unifiedBoundingBoxes = aggregateBoundingBox(allBoundingBoxes);
  const { min, max } = unifiedBoundingBoxes;
  const extent = {
    width: max[0] - min[0],
    height: max[1] - min[1],
    depth: max[2] - min[2],
    min,
    max,
  };
  return extent;
}

function getDatasetExtentInLength(dataset: APIDataset) {
  const extentInVoxel = getDatasetExtentInVoxel(dataset);
  const { scale } = dataset.dataSource;
  const extent = {
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
  if (!dataset.dataSource.dataLayers || !dataset.dataSource.scale || !dataset.isActive) {
    return "";
  }
  const importedDataset = ((dataset: any): APIDataset);
  if (inVoxel) {
    const extentInVoxel = getDatasetExtentInVoxel(importedDataset);
    return `${formatExtentWithLength(extentInVoxel, x => `${x}`)} voxel³`;
  }
  const extent = getDatasetExtentInLength(importedDataset);
  return formatExtentWithLength(extent, formatNumberToLength);
}

export function determineAllowedModes(
  dataset: APIDataset,
  settings?: Settings,
): { preferredMode: ?APIAllowedMode, allowedModes: Array<APIAllowedMode> } {
  // The order of allowedModes should be independent from the server and instead be similar to ViewModeValues
  let allowedModes = settings
    ? _.intersection(ViewModeValues, settings.allowedModes)
    : ViewModeValues;

  const colorLayer = _.find(dataset.dataSource.dataLayers, {
    category: "color",
  });
  if (colorLayer != null && colorLayer.elementClass !== "uint8") {
    allowedModes = allowedModes.filter(mode => !constants.MODES_ARBITRARY.includes(mode));
  }

  let preferredMode = null;
  if (settings && settings.preferredMode != null) {
    const modeId = settings.preferredMode;
    if (allowedModes.includes(modeId)) {
      preferredMode = modeId;
    }
  }

  return { preferredMode, allowedModes };
}

export function getBitDepth(layerInfo: DataLayerType): number {
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
      return true;
    case "int64":
    case "uint64":
    case "double":
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

export function getSegmentationLayer(dataset: APIDataset): ?APISegmentationLayer {
  const segmentationLayers = dataset.dataSource.dataLayers.filter(dataLayer =>
    isSegmentationLayer(dataset, dataLayer.name),
  );
  if (segmentationLayers.length === 0) {
    return null;
  }
  // Currently, only one segmentationLayer at a time is supported
  // Flow does not understand that this is a segmentation layer (since
  // we checked via `isSegmentationLayer`).
  // $FlowFixMe
  return segmentationLayers[0];
}

export function hasSegmentation(dataset: APIDataset): boolean {
  return getSegmentationLayer(dataset) != null;
}

export function getColorLayers(dataset: APIDataset): Array<DataLayerType> {
  return dataset.dataSource.dataLayers.filter(dataLayer => isColorLayer(dataset, dataLayer.name));
}

export function getEnabledLayers(
  dataset: APIDataset,
  datasetConfiguration: DatasetConfiguration,
  options: { invert?: boolean, onlyColorLayers: boolean } = { onlyColorLayers: false },
): Array<DataLayerType> {
  const dataLayers = options.onlyColorLayers
    ? getColorLayers(dataset)
    : dataset.dataSource.dataLayers;
  const layerSettings = datasetConfiguration.layers;

  return dataLayers.filter(layer => {
    const settings = layerSettings[layer.name];
    if (settings == null) {
      return false;
    }
    return settings.isDisabled === Boolean(options.invert);
  });
}

export function getThumbnailURL(dataset: APIDataset): string {
  const datasetName = dataset.name;
  const organizationName = dataset.owningOrganization;
  const layers = dataset.dataSource.dataLayers;
  const colorLayer = _.find(layers, { category: "color" });
  if (colorLayer) {
    return `/api/datasets/${organizationName}/${datasetName}/layers/${colorLayer.name}/thumbnail`;
  }
  return "";
}

export function getSegmentationThumbnailURL(dataset: APIDataset): string {
  const datasetName = dataset.name;
  const organizationName = dataset.owningOrganization;
  const segmentationLayer = getSegmentationLayer(dataset);
  if (segmentationLayer) {
    return `/api/datasets/${organizationName}/${datasetName}/layers/${
      segmentationLayer.name
    }/thumbnail`;
  }
  return "";
}

function _keyResolutionsByMax(dataset: APIDataset): { [number]: Vector3 } {
  const resolutions = getResolutions(dataset);
  return _.keyBy(resolutions, res => Math.max(...res));
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
): boolean {
  const layerConfig = datasetConfiguration.layers[layerName];
  return !layerConfig.isDisabled && layerConfig.alpha > 0;
}

export default {};
