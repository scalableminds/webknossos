// @flow

import { Button } from "antd";
import React, { useState, useEffect } from "react";
import * as Utils from "libs/utils";

import type { APIDataset, APIDatasetId } from "admin/api_flow_types";
import { getDataset, deleteDatasetOnDisk } from "admin/admin_rest_api";
import Toast from "libs/toast";
import messages from "messages";

import { confirmAsync } from "./helper_components";

type Props = {
  datasetId: APIDatasetId,
};

export default function ImportSharingComponent({ datasetId }: Props) {
  const [isDeleting, setIsDeleting] = useState(false);
  const [dataSet, setDataSet] = useState<?APIDataset>(null);

  async function fetch() {
    const newDataSet = await getDataset(datasetId);
    setDataSet(newDataSet);
  }

  useEffect(() => {
    fetch();
  }, []);

  async function handleDeleteButtonClicked(): Promise<void> {
    if (!dataSet) {
      return;
    }
    await confirmAsync({
      title: "Deleting a dataset on disk cannot be undone. Are you certain?",
      okText: "Yes, Delete Dataset on Disk now",
    });
    setIsDeleting(true);
    await deleteDatasetOnDisk(dataSet.dataStore.url, datasetId);
    Toast.success(
      messages["dataset.delete_success"]({
        datasetName: dataSet.name,
      }),
    );
    await Utils.sleep(2000);
    setIsDeleting(false);
    location.href = "/dashboard";
  }

  return (
    <div>
      <p>Deleting a dataset on disk cannot be undone. Please be certain.</p>
      <p>Note that annotations for the dataset stay downloadable and the name stays reserved.</p>
      <p>Only admins are allowed to delete datasets.</p>
      <Button type="danger" loading={isDeleting} onClick={handleDeleteButtonClicked}>
        Delete Dataset on Disk
      </Button>
    </div>
  );
}
