import React, { useState } from "react";
import DatasetAddRemoteView from "admin/dataset/dataset_add_remote_view";
import { useFetch } from "libs/react_helpers";
import { getDatastores } from "admin/admin_rest_api";
import { DatasetAddType, getPostUploadModal } from "./dataset_add_view";
import * as Utils from "libs/utils";
import _ from "lodash";
import { useHistory } from "react-router-dom";

export function DatasetURLImport() {
  const history = useHistory();
  const [datasetName, setDatasetName] = useState("");
  const [organization, setOrganization] = useState("");
  const [datasetNeedsConversion, setDatasetNeedsConversion] = useState(false);
  const [datasetAddType, setImportType] = useState<DatasetAddType>(DatasetAddType.UPLOAD);
  const [showPostUploadModal, setShowPostUploadModal] = useState(false);
  const datastores = useFetch(async () => await getDatastores(), null, []);
  const params = Utils.getUrlParamsObject();
  const datasetUri = _.has(params, "url") ? params.url : null;
  const handleDatasetAdded = async (
    datasetAddType: DatasetAddType,
    datasetOrganization: string,
    uploadedDatasetName: string,
    needsConversion: boolean | null | undefined,
  ): Promise<void> => {
    setOrganization(datasetOrganization);
    setDatasetName(uploadedDatasetName);
    setImportType(datasetAddType);
    if (needsConversion != null) setDatasetNeedsConversion(needsConversion);
    setShowPostUploadModal(true);
  };

  const postUploadModal = () => {
    if (!showPostUploadModal) return null;
    if (!datasetNeedsConversion) {
      history.push(`/datasets/${organization}/${datasetName}/view`);
      return;
    }
    return getPostUploadModal(
      datasetNeedsConversion,
      datasetAddType,
      organization,
      datasetName,
      setDatasetName,
      history,
    );
  };
  return datastores != null ? (
    <>
      <DatasetAddRemoteView
        datastores={datastores}
        onAdded={handleDatasetAdded.bind(null, DatasetAddType.REMOTE)}
        defaultDatasetUrl={datasetUri}
      />
      {postUploadModal()}
    </>
  ) : null;
}
