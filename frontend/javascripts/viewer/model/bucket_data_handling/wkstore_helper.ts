import type { APIDataset } from "types/api_types";
import type { StoreAnnotation } from "viewer/store";

export type LayerSourceInfo = {
  dataset: APIDataset;
  annotation: StoreAnnotation | null;
  tracingId: string | undefined;
  segmentationLayerName: string;
  useDataStore?: boolean | undefined | null;
};

export function getDataOrTracingStoreUrl(layerSourceInfo: LayerSourceInfo) {
  const { dataset, annotation, segmentationLayerName, tracingId, useDataStore } = layerSourceInfo;
  if (annotation == null || tracingId == null || useDataStore) {
    return `${dataset.dataStore.url}/data/datasets/${dataset.id}/layers/${segmentationLayerName}`;
  } else {
    const tracingStoreHost = annotation?.tracingStore.url;
    return `${tracingStoreHost}/tracings/volume/${tracingId}`;
  }
}
