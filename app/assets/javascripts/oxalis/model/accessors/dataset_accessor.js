// @flow
import _ from "lodash";
import constants from "oxalis/constants";
import type { APIDatasetType } from "admin/api_flow_types";
import type { Vector3 } from "oxalis/constants";
import type { DataLayerType } from "oxalis/store";
import ErrorHandling from "libs/error_handling";
import messages from "messages";

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

export function getLayerByName(dataset: APIDatasetType, layerName: string): DataLayerType {
  const { dataLayers } = dataset.dataSource;
  const hasUniqueNames = _.uniq(dataLayers).length === dataLayers.length;
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

export default {};
