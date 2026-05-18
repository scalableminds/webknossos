import { useQueryClient } from "@tanstack/react-query";
import { SettingsCard } from "admin/account/helpers/settings_card";
import { SettingsTitle } from "admin/account/helpers/settings_title";
import { deleteDatasetOnDisk } from "admin/rest_api";
import { Button, Col, Row } from "antd";
import Toast from "libs/toast";
import { UNDO_SECONDS } from "libs/delete_with_undo";
import { UndoButton } from "libs/undo_button";
import { useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import type { APIDatasetCompact } from "types/api_types";
import { useDatasetSettingsContext } from "./dataset_settings_context";

const DatasetSettingsDeleteTab = () => {
  const { dataset } = useDatasetSettingsContext();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleDeleteButtonClicked = useCallback(async () => {
    if (!dataset) {
      return;
    }

    const toastKey = `delete-dataset-${dataset.id}`;
    const snapshot = queryClient.getQueryData<APIDatasetCompact[]>([
      "datasetsByFolder",
      dataset.folderId,
    ]);

    queryClient.setQueryData(
      ["datasetsByFolder", dataset.folderId],
      (oldItems: APIDatasetCompact[] | undefined) =>
        oldItems?.filter((item) => item.id !== dataset.id),
    );
    queryClient.invalidateQueries({ queryKey: ["dataset", "search"] });
    navigate("/dashboard");

    const undo = () => {
      if (timeoutRef.current != null) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      Toast.close(toastKey);
      queryClient.setQueryData(["datasetsByFolder", dataset.folderId], snapshot);
      queryClient.invalidateQueries({ queryKey: ["dataset", "search"] });
    };

    Toast.info(`Dataset "${dataset.name}" was deleted.`, {
      key: toastKey,
      sticky: true,
      customFooter: <UndoButton onUndo={undo} seconds={UNDO_SECONDS} />,
    });

    timeoutRef.current = setTimeout(async () => {
      Toast.close(toastKey);
      try {
        await deleteDatasetOnDisk(dataset.id);
        queryClient.invalidateQueries({ queryKey: ["datasetsByFolder", dataset.folderId] });
        queryClient.invalidateQueries({ queryKey: ["dataset", "search"] });
      } catch (_e) {
        Toast.error(`Failed to delete dataset ${dataset.name}.`);
        queryClient.setQueryData(["datasetsByFolder", dataset.folderId], snapshot);
      }
    }, UNDO_SECONDS * 1000);
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
                <p>
                  Admins, dataset managers and team managers of the datasets' team(s) are allowed to
                  delete datasets.
                </p>
                <Button danger onClick={handleDeleteButtonClicked}>
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
