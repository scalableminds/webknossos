import type { APIDataLayer } from "types/api_types";
import { getReadableNameByVolumeTracingId } from "viewer/model/accessors/volumetracing_accessor";
import type { StoreAnnotation } from "viewer/store";

export function getZarrBaseUrl(
  dataStoreUrl: string,
  apiVersion: number,
  datasetId: string,
  maybeAccessToken: string | null,
): string {
  return maybeAccessToken
    ? `${dataStoreUrl}/data/v${apiVersion}/annotations/zarr3/${maybeAccessToken}`
    : `${dataStoreUrl}/data/v${apiVersion}/zarr3/${datasetId}`;
}

// Volume annotation layers are exposed under their readable name by the annotation zarr routes.
export function getZarrLayerName(layer: APIDataLayer, annotation: StoreAnnotation): string {
  return "tracingId" in layer && layer.tracingId != null
    ? getReadableNameByVolumeTracingId(annotation, layer.tracingId)
    : layer.name;
}
