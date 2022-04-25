import { Button } from "antd";
import React, { useState, useEffect, useContext } from "react";
import type { APIDataset, APIDatasetId } from "types/api_flow_types";
import { getDataset, deleteDatasetOnDisk } from "admin/admin_rest_api";
import Toast from "libs/toast";
import messages from "messages";
import type { RouteComponentProps } from "react-router-dom";
import { withRouter } from "react-router-dom";
import { DatasetCacheContext } from "dashboard/dataset/dataset_cache_provider";
import { confirmAsync } from "./helper_components";
type Props = {
  datasetId: APIDatasetId;
  history: RouteComponentProps["history"];
};

const ImportDeleteComponent = ({ datasetId, history }: Props) => {
  const [isDeleting, setIsDeleting] = useState(false);
  const [dataset, setDataset] = useState<APIDataset | null | undefined>(null);
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
      title: `Deleting a dataset on disk cannot be undone. Are you certain to delete dataset ${dataset.name}?`,
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
    // Refresh the dataset list to exclude the deleted dataset
    await datasetContext.fetchDatasets();
    history.push("/dashboard");
  }

  return (
    <div>
      <p>Deleting a dataset on disk cannot be undone. Please be certain.</p>
      <p>Note that annotations for the dataset stay downloadable and the name stays reserved.</p>
      <p>Only admins are allowed to delete datasets.</p>
      <Button danger loading={isDeleting} onClick={handleDeleteButtonClicked}>
        Delete Dataset on Disk
      </Button>
    </div>
  );
};

export default withRouter<RouteComponentProps & Props, any>(ImportDeleteComponent);
