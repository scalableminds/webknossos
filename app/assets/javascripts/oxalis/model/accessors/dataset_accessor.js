// @flow
import _ from "lodash";
import type { APIDatasetType } from "admin/api_flow_types";
import type { Vector3 } from "oxalis/constants";

export function getResolutions(dataset: APIDatasetType): Vector3[] {
  // Different layers can have different resolutions. At the moment,
  // unequal resolutions will result in undefined behavior.
  // However, if resolutions are subset of each other, everything should be fine.
  // For that case, returning the longest resolutions array should suffice

  return _.chain(dataset.dataSource.dataLayers)
    .map(dataLayer => dataLayer.resolutions)
    .sortBy(resolutions => resolutions.length)
    .last()
    .valueOf();
}

export default {};
