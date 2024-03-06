import type { APIDataset, CoordinateTransformation } from "types/api_flow_types";
type SetDatasetAction = ReturnType<typeof setDatasetAction>;
type SetLayerMappingsAction = ReturnType<typeof setLayerMappingsAction>;
type SetLayerTransformsAction = ReturnType<typeof setLayerTransformsAction>;
export type EnsureLayerMappingsAreLoadedAction = ReturnType<
  typeof ensureLayerMappingsAreLoadedAction
>;

export type DatasetAction =
  | SetDatasetAction
  | SetLayerMappingsAction
  | SetLayerTransformsAction
  | EnsureLayerMappingsAreLoadedAction;

export const setDatasetAction = (dataset: APIDataset) =>
  ({
    type: "SET_DATASET",
    dataset,
  }) as const;

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
  }) as const;

export const setLayerTransformsAction = (
  layerName: string,
  coordinateTransformations: CoordinateTransformation[] | null,
) =>
  ({
    type: "SET_LAYER_TRANSFORMS",
    layerName,
    coordinateTransformations,
  }) as const;

export const ensureLayerMappingsAreLoadedAction = (layerName?: string) =>
  ({
    type: "ENSURE_LAYER_MAPPINGS_ARE_LOADED",
    layerName,
  }) as const;
