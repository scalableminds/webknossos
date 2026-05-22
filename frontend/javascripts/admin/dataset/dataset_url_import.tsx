import DatasetAddRemoteView from "admin/dataset/dataset_add_remote_view";
import { findDatasetByImportUrl, getDatastores } from "admin/rest_api";
import type { LoaderFunctionArgs } from "react-router-dom";
import { redirect, useLoaderData, useNavigate } from "react-router-dom";
import type { APIDataStore } from "types/api_types";
import { getViewDatasetURL } from "viewer/model/accessors/dataset_accessor";

export async function datasetURLImportLoader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const datasetUri = url.searchParams.get("url");

  if (datasetUri != null) {
    let existingDataset;
    try {
      existingDataset = await findDatasetByImportUrl(datasetUri);
    } catch (e) {
      console.error("Check for existing dataset with the same remote URL failed.", e);
    }
    if (existingDataset?.dataSource) {
      throw redirect(getViewDatasetURL(existingDataset));
    }
  }

  const datastores = await getDatastores();

  return { datastores, datasetUri };
}

type LoaderData = {
  datastores: APIDataStore[];
  datasetUri: string | null;
};

export function DatasetURLImport() {
  const navigate = useNavigate();
  const { datastores, datasetUri } = useLoaderData() as LoaderData;

  const handleDatasetAdded = async (addedDatasetId: string): Promise<void> => {
    navigate(`/datasets/${addedDatasetId}/view`);
  };

  return (
    <DatasetAddRemoteView
      datastores={datastores}
      onAdded={handleDatasetAdded}
      defaultDatasetUrl={datasetUri}
    />
  );
}
