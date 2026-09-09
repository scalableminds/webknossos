import { Button, Modal, Space, Typography } from "antd";
import type { useNavigate } from "react-router";
import { ModalWidth } from "theme";
import { getReadableURLPart, getViewDatasetURL } from "viewer/model/accessors/dataset_accessor";
import type { DatasetAddType } from "../dataset_add_view";

const addTypeToVerb: Record<DatasetAddType, string> = {
  upload: "uploaded",
  remote: "added",
  compose: "created",
};

const addTypeToTitle: Record<DatasetAddType, string> = {
  upload: "Dataset Uploaded",
  remote: "Dataset Added",
  compose: "Dataset Created",
};

type Props = {
  datasetNeedsConversion: boolean;
  datasetAddType: DatasetAddType;
  datasetId: string;
  uploadedDatasetName: string;
  setDatasetId: (arg0: string) => void;
  navigate: ReturnType<typeof useNavigate>;
};

export default function PostUploadModal({
  datasetNeedsConversion,
  datasetAddType,
  datasetId,
  uploadedDatasetName,
  setDatasetId,
  navigate,
}: Props) {
  const close = () => setDatasetId("");
  return (
    <Modal
      open
      closable
      mask={{ closable: false }}
      onCancel={close}
      onOk={close}
      width={ModalWidth.Medium}
      title={addTypeToTitle[datasetAddType]}
      footer={
        datasetNeedsConversion ? (
          <Space>
            <Button onClick={() => navigate("/dashboard/datasets")}>Go to Dashboard</Button>
            <Button type="primary" onClick={() => navigate("/jobs")}>
              View the Jobs Queue
            </Button>
          </Space>
        ) : (
          <Space>
            <Button onClick={() => navigate("/dashboard/datasets")}>Go to Dashboard</Button>
            <Button
              onClick={() =>
                navigate(
                  `/datasets/${getReadableURLPart({ name: uploadedDatasetName, id: datasetId })}/edit`,
                )
              }
            >
              Go to Dataset Settings
            </Button>
            <Button
              type="primary"
              onClick={() =>
                navigate(getViewDatasetURL({ name: uploadedDatasetName, id: datasetId }))
              }
            >
              View the Dataset
            </Button>
          </Space>
        )
      }
    >
      <Typography.Paragraph>
        The dataset{" "}
        {uploadedDatasetName && (
          <>
            <Typography.Text strong>{uploadedDatasetName}</Typography.Text>{" "}
          </>
        )}
        was {addTypeToVerb[datasetAddType]} successfully.
      </Typography.Paragraph>
      <Typography.Paragraph>
        {datasetNeedsConversion
          ? "A background conversion job has been started to prepare your data. You can track the progress in the jobs queue or return to the dashboard."
          : "Your dataset is now ready to use. You can open it in the viewer, configure its settings, or return to the dashboard."}
      </Typography.Paragraph>
    </Modal>
  );
}
