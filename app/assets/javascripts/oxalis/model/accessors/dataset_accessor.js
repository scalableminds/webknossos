// @flow
import _ from "lodash";
import messages from "messages";
import ErrorHandling from "libs/error_handling";
import constants, { Vector3Indicies, ModeValues } from "oxalis/constants";
import type { APIDatasetType } from "admin/api_flow_types";
import type { Vector3 } from "oxalis/constants";
import type { SettingsType, DataLayerType } from "oxalis/store";

export function getResolutions(dataset: APIDatasetType): Vector3[] {
  // Different layers can have different resolutions. At the moment,
  // unequal resolutions will result in undefined behavior.
  // However, if resolutions are subset of each other, everything should be fine.
  // For that case, returning the longest resolutions array should suffice

  const mostExtensiveResolutions = _.chain(dataset.dataSource.dataLayers)
    .map(dataLayer => dataLayer.resolutions)
    .sortBy(resolutions => resolutions.length)
    .last()
    .valueOf();
  if (!mostExtensiveResolutions) {
    return [];
  }

  const lastResolution = _.last(mostExtensiveResolutions);

  // We add another level of resolutions to allow zooming out even further
  const extendedResolutions = _.range(constants.DOWNSAMPLED_ZOOM_STEP_COUNT).map(idx =>
    lastResolution.map(el => 2 ** (idx + 1) * el),
  );

  return mostExtensiveResolutions.concat(extendedResolutions);
}

function getDataLayers(dataset: APIDatasetType): DataLayerType[] {
  return dataset.dataSource.dataLayers;
}

export function getLayerByName(dataset: APIDatasetType, layerName: string): DataLayerType {
  const dataLayers = getDataLayers(dataset);
  const hasUniqueNames = _.uniqBy(dataLayers, "name").length === dataLayers.length;
  ErrorHandling.assert(hasUniqueNames, messages["dataset.unique_layer_names"]);

  const layer = dataLayers.find(l => l.name === layerName);
  if (!layer) {
    throw new Error(`Layer "${layerName}" not found`);
  }
  return layer;
}

export function getMappings(dataset: APIDatasetType, layerName: string): string[] {
  return getLayerByName(dataset, layerName).mappings || [];
}

export function isRgb(dataset: APIDatasetType, layerName: string): boolean {
  return (
    getLayerByName(dataset, layerName).category === "color" &&
    getByteCount(dataset, layerName) === 3
  );
}

export function getByteCount(dataset: APIDatasetType, layerName: string): number {
  return getBitDepth(getLayerByName(dataset, layerName)) >> 3;
}

type BoundaryType = { lowerBoundary: Vector3, upperBoundary: Vector3 };

export function getLayerBoundaries(dataset: APIDatasetType, layerName: string): BoundaryType {
  const { topLeft, width, height, depth } = getLayerByName(dataset, layerName).boundingBox;
  const lowerBoundary = topLeft;
  const upperBoundary = [topLeft[0] + width, topLeft[1] + height, topLeft[2] + depth];

  return { lowerBoundary, upperBoundary };
}

export function getBoundaries(dataset: APIDatasetType): BoundaryType {
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

export function getDatasetCenter(dataset: APIDatasetType): Vector3 {
  const { lowerBoundary, upperBoundary } = getBoundaries(dataset);
  return [
    (lowerBoundary[0] + upperBoundary[0]) / 2,
    (lowerBoundary[1] + upperBoundary[1]) / 2,
    (lowerBoundary[2] + upperBoundary[2]) / 2,
  ];
}

export function determineAllowedModes(dataset: APIDatasetType, settings: SettingsType): * {
  // The order of allowedModes should be independent from the server and instead be similar to ModeValues
  let allowedModes = _.intersection(ModeValues, settings.allowedModes);

  const colorLayer = _.find(dataset.dataSource.dataLayers, {
    category: "color",
  });
  if (colorLayer != null && colorLayer.elementClass !== "uint8") {
    allowedModes = allowedModes.filter(mode => !constants.MODES_ARBITRARY.includes(mode));
  }

  let preferredMode = null;
  if (settings.preferredMode != null) {
    const modeId = settings.preferredMode;
    if (allowedModes.includes(modeId)) {
      preferredMode = modeId;
    }
  }

  return { preferredMode, allowedModes };
}

export function getBitDepth(layerInfo: DataLayerType): number {
  return parseInt(layerInfo.elementClass.substring(4), 10);
}

export function isSegmentationLayer(dataset: APIDatasetType, layerName: string): boolean {
  return getLayerByName(dataset, layerName).category === "segmentation";
}

export function isColorLayer(dataset: APIDatasetType, layerName: string): boolean {
  return getLayerByName(dataset, layerName).category === "color";
}

export function getSegmentationLayer(dataset: APIDatasetType): ?DataLayerType {
  const segmentationLayers = dataset.dataSource.dataLayers.filter(dataLayer =>
    isSegmentationLayer(dataset, dataLayer.name),
  );
  if (segmentationLayers.length === 0) {
    return null;
  }
  // Currently, only one segmentationLayer at a time is supported
  return segmentationLayers[0];
}

export function getColorLayers(dataset: APIDatasetType): Array<DataLayerType> {
  return dataset.dataSource.dataLayers.filter(dataLayer => isColorLayer(dataset, dataLayer.name));
}

export default {};
