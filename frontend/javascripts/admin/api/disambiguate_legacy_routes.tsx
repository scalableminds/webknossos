import Request from "libs/request";

export async function getOrganizationForDataset(datasetName: string): Promise<string> {
  const { organizationId } = await Request.receiveJSON(
    `/api/datasets/disambiguate/${datasetName}/toNew`,
  );
  return organizationId;
}

export async function getDatasetIdFromNameAndOrganization(
  datasetName: string,
  organizationId: string,
): Promise<string> {
  const { id: datasetId } = await Request.receiveJSON(
    `/api/datasets/disambiguate/${organizationId}/${datasetName}/toId`,
  );
  return datasetId;
}
