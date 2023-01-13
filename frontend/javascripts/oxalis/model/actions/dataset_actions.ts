import { Matrix4x4 } from "mjs";
import type { APIDataset } from "types/api_flow_types";
type SetDatasetAction = ReturnType<typeof setDatasetAction>;
type SetLayerMappingsAction = ReturnType<typeof setLayerMappingsAction>;
type SetLayerTransforms = ReturnType<typeof setLayerTransforms>;

export type DatasetAction = SetDatasetAction | SetLayerMappingsAction | SetLayerTransforms;

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

export const setLayerTransforms = (layerName: string, transformMatrix: Matrix4x4) =>
  ({
    type: "SET_LAYER_TRANSFORMS",
    layerName,
    transformMatrix,
  } as const);
