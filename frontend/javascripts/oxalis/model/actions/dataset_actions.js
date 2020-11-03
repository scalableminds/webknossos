// @flow
import type { APIDataset } from "types/api_flow_types";

type SetDatasetAction = { type: "SET_DATASET", dataset: APIDataset };
type SetLayerMappingsAction = {
  type: "SET_LAYER_MAPPINGS",
  layerName: string,
  mappingNames: Array<string>,
  agglomerateNames: Array<string>,
};

export type DatasetAction = SetDatasetAction | SetLayerMappingsAction;

export const setDatasetAction = (dataset: APIDataset): SetDatasetAction => ({
  type: "SET_DATASET",
  dataset,
});

export const setLayerMappingsAction = (
  layerName: string,
  mappingNames: Array<string>,
  agglomerateNames: Array<string>,
): SetLayerMappingsAction => ({
  type: "SET_LAYER_MAPPINGS",
  layerName,
  mappingNames,
  agglomerateNames,
});
