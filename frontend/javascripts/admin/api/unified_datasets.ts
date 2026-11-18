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
