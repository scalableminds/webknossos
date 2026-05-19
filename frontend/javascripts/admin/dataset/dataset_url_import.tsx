import DatasetAddRemoteView from "admin/dataset/dataset_add_remote_view";
import { findDatasetByImportUrl, getDatastores } from "admin/rest_api";
import BrainSpinner from "components/brain_spinner";
import { useFetch } from "libs/react_helpers";
import Toast from "libs/toast";
import { getUrlParamsObject } from "libs/utils";
import has from "lodash-es/has";
import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { getViewDatasetURL } from "viewer/model/accessors/dataset_accessor";

export function DatasetURLImport() {
  const navigate = useNavigate();
  const params = getUrlParamsObject();
  const datasetUri = has(params, "url") ? params.url : null;
  // Check if there is already a dataset with the same import url.
  const { dataset: maybeExistingDS, checkedForExistence } = useFetch(
    async () => {
      let dataset = null;
      let checkedForExistence = false;
      if (datasetUri == null) return { dataset, checkedForExistence };
      try {
        dataset = await findDatasetByImportUrl(datasetUri);
        checkedForExistence = true;
      } catch (_e) {
        checkedForExistence = true;
        const errorText = "Check for existing dataset with the same remote URl failed.";
        Toast.error(errorText);
        console.error(errorText, _e);
      }
      return { dataset, checkedForExistence };
    },
    { dataset: null, checkedForExistence: false },
    [datasetUri],
  );
  const datastores = useFetch(async () => await getDatastores(), null, []);
  const handleDatasetAdded = async (addedDatasetId: string): Promise<void> => {
    navigate(`/datasets/${addedDatasetId}/view`);
  };

  useEffect(() => {
    if (maybeExistingDS?.dataSource) {
      navigate(getViewDatasetURL(maybeExistingDS), { replace: true });
    }
  }, [maybeExistingDS, navigate]);

  if ((datasetUri !== null && !checkedForExistence) || maybeExistingDS?.dataSource) {
    // First check whether there is already a dataset with this import url
    // before rendering DatasetAddRemoteView which potentially auto-imports the dataset
    // and would thus duplicate it.
    // In case a duplicate was found, also render a placeholder while navigating to this dataset.
    return <BrainSpinner />;
  }

  return datastores != null ? (
    <DatasetAddRemoteView
      datastores={datastores}
      onAdded={handleDatasetAdded}
      defaultDatasetUrl={datasetUri}
    />
  ) : null;
}
