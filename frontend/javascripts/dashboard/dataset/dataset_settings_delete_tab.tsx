import { useQueryClient } from "@tanstack/react-query";
import { SettingsCard } from "admin/account/helpers/settings_card";
import { SettingsTitle } from "admin/account/helpers/settings_title";
import { deleteDatasetOnDisk } from "admin/rest_api";
import { Button, Col, Row } from "antd";
import Toast from "libs/toast";
import messages from "messages";
import { useCallback, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useDatasetSettingsContext } from "./dataset_settings_context";
import { confirmAsync } from "./helper_components";

const DatasetSettingsDeleteTab = () => {
  const { dataset } = useDatasetSettingsContext();
  const [isDeleting, setIsDeleting] = useState(false);
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const handleDeleteButtonClicked = useCallback(async () => {
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

    navigate("/dashboard");
  }, [dataset, navigate, queryClient]);

  return (
    <div>
      <SettingsTitle title="Delete Dataset" description="Delete this dataset on disk" />
      <Row gutter={[24, 24]} style={{ marginBottom: 24 }}>
        <Col span={24}>
          <SettingsCard
            title="Delete Dataset"
            content={
              <>
                <p>Deleting a dataset on disk cannot be undone. Please be certain.</p>
                <p>
                  Note that annotations for the dataset stay downloadable and the name stays
                  reserved.
                </p>
                <p>Only admins are allowed to delete datasets.</p>
                <Button danger loading={isDeleting} onClick={handleDeleteButtonClicked}>
                  Delete Dataset on Disk
                </Button>
              </>
            }
          />
        </Col>
      </Row>
    </div>
  );
};

export default DatasetSettingsDeleteTab;
