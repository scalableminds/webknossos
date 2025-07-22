import DatasetAddRemoteView from "admin/dataset/dataset_add_remote_view";
import { getDatastores } from "admin/rest_api";
import { useFetch } from "libs/react_helpers";
import * as Utils from "libs/utils";
import _ from "lodash";
import { useNavigate } from "react-router-dom";

export function DatasetURLImport() {
  const navigate = useNavigate();
  const datastores = useFetch(async () => await getDatastores(), null, []);
  const params = Utils.getUrlParamsObject();
  const datasetUri = _.has(params, "url") ? params.url : null;
  const handleDatasetAdded = async (addedDatasetId: string): Promise<void> => {
    navigate(`/datasets/${addedDatasetId}/view`);
  };

  return datastores != null ? (
    <>
      <DatasetAddRemoteView
        datastores={datastores}
        onAdded={handleDatasetAdded}
        defaultDatasetUrl={datasetUri}
      />
    </>
  ) : null;
}
