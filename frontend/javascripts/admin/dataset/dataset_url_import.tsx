import DatasetAddRemoteView from "admin/dataset/dataset_add_remote_view";
import { useFetch } from "libs/react_helpers";
import { getDatastores } from "admin/admin_rest_api";
import * as Utils from "libs/utils";
import _ from "lodash";
import { useHistory } from "react-router-dom";

export function DatasetURLImport() {
  const history = useHistory();
  const datastores = useFetch(async () => await getDatastores(), null, []);
  const params = Utils.getUrlParamsObject();
  const datasetUri = _.has(params, "url") ? params.url : null;
  const handleDatasetAdded = async (
    datasetOrganization: string,
    uploadedDatasetName: string,
  ): Promise<void> => {
    history.push(`/datasets/${datasetOrganization}/${uploadedDatasetName}/view`);
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
