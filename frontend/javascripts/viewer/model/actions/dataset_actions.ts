import type { APIDataset, CoordinateTransformation } from "types/api_types";
import { StoreDataset } from "viewer/store";
type SetDatasetAction = ReturnType<typeof setDatasetAction>;
type SetLayerMappingsAction = ReturnType<typeof setLayerMappingsAction>;
type SetLayerTransformsAction = ReturnType<typeof setLayerTransformsAction>;
export type EnsureLayerMappingsAreLoadedAction = ReturnType<
  typeof ensureLayerMappingsAreLoadedAction
>;
type SetLayerHasSegmentIndexAction = ReturnType<typeof setLayerHasSegmentIndexAction>;
export type EnsureSegmentIndexIsLoadedAction = ReturnType<typeof ensureSegmentIndexIsLoadedAction>;

export type DatasetAction =
  | SetDatasetAction
  | SetLayerMappingsAction
  | SetLayerTransformsAction
  | EnsureLayerMappingsAreLoadedAction
  | SetLayerHasSegmentIndexAction
  | EnsureSegmentIndexIsLoadedAction;

export const setDatasetAction = (dataset: StoreDataset) =>
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

export const setLayerHasSegmentIndexAction = (layerName: string, hasSegmentIndex: boolean) =>
  ({
    type: "SET_LAYER_HAS_SEGMENT_INDEX",
    layerName,
    hasSegmentIndex,
  }) as const;

export const ensureSegmentIndexIsLoadedAction = (layerName: string | null | undefined) =>
  ({
    type: "ENSURE_SEGMENT_INDEX_IS_LOADED",
    layerName,
  }) as const;
