import { SettingsCard } from "admin/account/helpers/settings_card";
import { SettingsTitle } from "admin/account/helpers/settings_title";
import { Button, Col, Row } from "antd";
import { useDeleteDatasetsModal } from "dashboard/advanced_dataset/delete_datasets_modal";
import { useNavigate } from "react-router";
import { convertDatasetToCompact } from "types/api_types";
import { useDatasetSettingsContext } from "./dataset_settings_context";

const DatasetSettingsDeleteTab = () => {
  const { dataset } = useDatasetSettingsContext();
  const navigate = useNavigate();
  const { openDeleteModal, deleteModal } = useDeleteDatasetsModal({
    onDeleted: () => navigate("/dashboard"),
  });

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
                  Admins, dataset managers and team managers of the datasets’ team(s) are allowed to
                  delete datasets.
                </p>
                <Button
                  danger
                  disabled={dataset == null}
                  onClick={() => dataset && openDeleteModal([convertDatasetToCompact(dataset)])}
                >
                  Delete Dataset on Disk
                </Button>
              </>
            }
          />
        </Col>
      </Row>
      {deleteModal}
    </div>
  );
};

export default DatasetSettingsDeleteTab;
