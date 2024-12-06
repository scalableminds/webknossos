import { Button } from "antd";
import { useState, useEffect } from "react";
import type { APIDataset } from "types/api_flow_types";
import { getDataset, deleteDatasetOnDisk } from "admin/admin_rest_api";
import Toast from "libs/toast";
import messages from "messages";
import type { RouteComponentProps } from "react-router-dom";
import { withRouter } from "react-router-dom";
import { confirmAsync } from "./helper_components";
import { useQueryClient } from "@tanstack/react-query";

type Props = {
  datasetId: string;
  history: RouteComponentProps["history"];
};

const DatasetSettingsDeleteTab = ({ datasetId, history }: Props) => {
  const [isDeleting, setIsDeleting] = useState(false);
  const [dataset, setDataset] = useState<APIDataset | null | undefined>(null);
  const queryClient = useQueryClient();

  async function fetch() {
    const newDataset = await getDataset(datasetId);
    setDataset(newDataset);
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies(fetch):
  useEffect(() => {
    fetch();
  }, []);

  async function handleDeleteButtonClicked(): Promise<void> {
    if (!dataset) {
      return;
    }

    const deleteDataset = await confirmAsync({
      title: `Deleting a dataset on disk cannot be undone. Are you certain to delete dataset ${dataset.name}? Note that the name of a dataset is not guaranteed to be free to use afterwards.`,
      okText: "Yes, Delete Dataset on Disk now",
    });

    if (!deleteDataset) {
      return;
    }
    const dataSourceId = {
      owningOrganization: dataset.owningOrganization,
      directoryName: dataset.directoryName,
    };

    setIsDeleting(true);
    await deleteDatasetOnDisk(dataset.dataStore.url, dataSourceId);
    Toast.success(
      messages["dataset.delete_success"]({
        datasetName: dataset.name,
      }),
    );
    setIsDeleting(false);
    // Invalidate the dataset list cache to exclude the deleted dataset
    queryClient.invalidateQueries({
      queryKey: ["datasetsByFolder", dataset.folderId],
    });
    queryClient.invalidateQueries({ queryKey: ["dataset", "search"] });

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

export default withRouter<RouteComponentProps & Props, any>(DatasetSettingsDeleteTab);
