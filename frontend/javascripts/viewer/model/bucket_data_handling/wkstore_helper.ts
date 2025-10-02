import type { APIDataset } from "types/api_types";
import type { StoreAnnotation } from "viewer/store";

export type LayerSourceInfo = {
  dataset: APIDataset;
  annotation: StoreAnnotation | null;
  tracingId: string | undefined;
  visibleSegmentationLayerName: string;
  forceUsingDataStore?: boolean | undefined | null;
};

export function getDataOrTracingStoreUrl(layerSourceInfo: LayerSourceInfo) {
  const { dataset, annotation, visibleSegmentationLayerName, tracingId, forceUsingDataStore } =
    layerSourceInfo;
  if (annotation == null || tracingId == null || forceUsingDataStore) {
    return `${dataset.dataStore.url}/data/datasets/${dataset.id}/layers/${visibleSegmentationLayerName}`;
  } else {
    const tracingStoreHost = annotation?.tracingStore.url;
    return `${tracingStoreHost}/tracings/volume/${tracingId}`;
  }
}
