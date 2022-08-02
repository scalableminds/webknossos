import type { APIDataset } from "types/api_flow_types";
type SetDatasetAction = ReturnType<typeof setDatasetAction>;
type SetLayerMappingsAction = ReturnType<typeof setLayerMappingsAction>;

export type DatasetAction = SetDatasetAction | SetLayerMappingsAction;

export const setDatasetAction = (dataset: APIDataset) =>
  ({
    type: "SET_DATASET",
    dataset,
  } as const);

export const setLayerMappingsAction = (
  layerName: string,
  mappingNames: Array<string>,
  agglomerateNames: Array<string>,
) =>
  ({
    type: "SET_LAYER_MAPPINGS",
    layerName,
    mappingNames,
    agglomerateNames,
  } as const);
