import Request, { type RequestOptions } from "libs/request";

export async function getOrganizationForDataset(
  datasetName: string,
  sharingToken?: string | null | undefined,
): Promise<string> {
  const sharingTokenSuffix = sharingToken != null ? `?sharingToken=${sharingToken}` : "";
  const { organization: organizationId } = await Request.receiveJSON(
    `/api/datasets/disambiguate/${datasetName}/toNew${sharingTokenSuffix}`,
  );
  return organizationId;
}

export async function getDatasetIdFromNameAndOrganization(
  datasetName: string,
  organizationId: string,
  sharingToken?: string | null | undefined,
  options: RequestOptions = {},
): Promise<string> {
  const sharingTokenSuffix = sharingToken != null ? `?sharingToken=${sharingToken}` : "";
  const { id: datasetId } = await Request.receiveJSON(
    `/api/datasets/disambiguate/${organizationId}/${datasetName}/toId${sharingTokenSuffix}`,
    options,
  );
  return datasetId;
}
