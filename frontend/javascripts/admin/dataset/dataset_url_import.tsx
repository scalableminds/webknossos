import React, { useState } from "react";
import DatasetAddRemoteView from "admin/dataset/dataset_add_remote_view";
import { useFetch } from "libs/react_helpers";
import { APIDataStore } from "types/api_flow_types";
import { getDatastores } from "admin/admin_rest_api";
import { DatasetAddType } from "./dataset_add_view";
import * as Utils from "libs/utils";
import _ from "lodash";

export function DatasetURLImport() {
  const [hasFetched, setHasFetched] = useState(false);
  const [datastores, setDatastores] = useState<APIDataStore[]>([]);
  useFetch(
    async () => {
      setDatastores(await getDatastores());
      setHasFetched(true);
    },
    null,
    [],
  );
  const params = Utils.getUrlParamsObject();
  const datasetUri = _.has(params, "uri") ? params.uri : null;
  const handleDatasetAdded = async (
    datasetAddType: DatasetAddType,
    datasetOrganization: string,
    uploadedDatasetName: string,
    needsConversion: boolean | null | undefined,
  ): Promise<void> => {
    console.log("added");
  };
  return hasFetched ? (
    <DatasetAddRemoteView
      datastores={datastores}
      onAdded={handleDatasetAdded.bind(null, DatasetAddType.REMOTE)}
      defaultDatasetUrl={datasetUri}
    />
  ) : null;
}
