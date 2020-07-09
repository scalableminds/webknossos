// @flow

import { Button, Input, Checkbox, Tooltip } from "antd";
import Clipboard from "clipboard-js";
import React, { useState, useEffect } from "react";

import type { APIDataset, APIDatasetId } from "admin/api_flow_types";
import { AsyncButton } from "components/async_clickables";
import { getDataset, deleteDatasetOnDisk } from "admin/admin_rest_api";
import Toast from "libs/toast";
import features from "features";
import window from "libs/window";

import { FormItemWithInfo, confirmAsync } from "./helper_components";

type Props = {
  datasetId: APIDatasetId,
};

export default function ImportSharingComponent({ datasetId }: Props) {
  const [dataSet, setDataSet] = useState<?APIDataset>(null);

  async function fetch() {
    const newDataSet = await getDataset(datasetId);
    setDataSet(newDataSet);
  }

  useEffect(() => {
    fetch();
  }, []);

  async function handleDeleteButtonClicked(): Promise<void> {
    await confirmAsync({
      title: "Deleting a dataset on disk cannot be undone. Are you certain?",
      okText: "Yes, Delete Dataset on Disk now",
    });
    await deleteDatasetOnDisk(dataSet.dataStore.url, datasetId);
  }

  return (
    <div>
      <p>Deleting a dataset on disk cannot be undone. Please be certain.</p>
      <Button type="danger" onClick={handleDeleteButtonClicked}>
        Delete Dataset on Disk
      </Button>
    </div>
  );
}
