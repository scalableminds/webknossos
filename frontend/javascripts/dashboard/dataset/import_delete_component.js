// @flow

import { Button } from "antd";
import React, { useState, useEffect, useContext } from "react";
import * as Utils from "libs/utils";

import type { APIDataset, APIDatasetId } from "admin/api_flow_types";
import { getDataset, deleteDatasetOnDisk } from "admin/admin_rest_api";
import Toast from "libs/toast";
import messages from "messages";

import { type RouterHistory, withRouter } from "react-router-dom";
import { DatasetCacheContext } from "dashboard/dataset/dataset_cache_provider";
import { confirmAsync } from "./helper_components";

type Props = {
  datasetId: APIDatasetId,
  history: RouterHistory,
};

const ImportDeleteComponent = ({ datasetId, history }: Props) => {
  const [isDeleting, setIsDeleting] = useState(false);
  const [dataset, setDataset] = useState<?APIDataset>(null);
  const datasetContext = useContext(DatasetCacheContext);

  async function fetch() {
    const newDataset = await getDataset(datasetId);
    setDataset(newDataset);
  }

  useEffect(() => {
    fetch();
  }, []);

  async function handleDeleteButtonClicked(): Promise<void> {
    if (!dataset) {
      return;
    }
    const deleteDataset = await confirmAsync({
      title: `Deleting a dataset on disk cannot be undone. Are you certain to delete dataset ${
        dataset.name
      }?`,
      okText: "Yes, Delete Dataset on Disk now",
    });
    if (!deleteDataset) {
      return;
    }
    setIsDeleting(true);
    await deleteDatasetOnDisk(dataset.dataStore.url, datasetId);
    Toast.success(
      messages["dataset.delete_success"]({
        datasetName: dataset.name,
      }),
    );
    setIsDeleting(false);
    // Trigger dataset check to make sure the dataset list is up-to-date
    // but also make sure that the toast can be read
    await Promise.all([datasetContext.checkDatasets(), Utils.sleep(2000)]);
    history.push("/dashboard");
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
};

export default withRouter(ImportDeleteComponent);
