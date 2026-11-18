// REST calls of the unified datasets prototype (features.unifiedDatasets).
import Request from "libs/request";

export type BackingAnnotationAccess = "edit" | "read" | "none";
export type BackingAnnotationInfo = {
  // null if the dataset has no annotation layers the requesting user may see.
  annotationId: string | null;
  access: BackingAnnotationAccess;
};

export function getBackingAnnotation(
  datasetId: string,
  sharingToken?: string | null,
): Promise<BackingAnnotationInfo> {
  const params = new URLSearchParams();
  if (sharingToken != null) {
    params.set("sharingToken", sharingToken);
  }
  return Request.receiveJSON(`/api/datasets/${datasetId}/backingAnnotation?${params}`, {
    method: "POST",
  });
}

export type CopyDatasetRequest = {
  name: string;
  // All data layers if omitted.
  layerNames?: string[];
  includeAnnotationLayers: boolean;
};

export function copyDataset(
  datasetId: string,
  request: CopyDatasetRequest,
  sharingToken?: string | null,
): Promise<{ newDatasetId: string }> {
  const params = new URLSearchParams();
  if (sharingToken != null) {
    params.set("sharingToken", sharingToken);
  }
  return Request.sendJSONReceiveJSON(`/api/datasets/${datasetId}/copy?${params}`, {
    method: "POST",
    data: request,
  });
}

export function convertAnnotationToDataset(
  annotationId: string,
): Promise<{ datasetId: string | null; datasetName: string | null }> {
  return Request.receiveJSON(`/api/annotations/${annotationId}/convertToDataset`, {
    method: "POST",
    // Task annotations and annotations without access fall back to the legacy view, so don't toast.
    showErrorToast: false,
  });
}
