import { useQuery } from "@tanstack/react-query";
import { getDataset } from "admin/rest_api";
import { Button, Modal, Space, Typography } from "antd";
import { useWkSelector } from "libs/react_hooks";
import { Link, type useNavigate } from "react-router";
import { ModalWidth } from "theme";
import type { APIDataset } from "types/api_types";
import { getReadableURLPart, getViewDatasetURL } from "viewer/model/accessors/dataset_accessor";
import {
  canRunAIAlignment,
  getViewDatasetUrlWithAIAlignment,
} from "viewer/view/ai_jobs/ai_job_url_param";

// How a dataset was added: the tab keys of the "Add Dataset" page (dataset_add_view.tsx), also
// used to describe the added dataset in this modal.
export enum DatasetAddType {
  UPLOAD = "upload",
  REMOTE = "remote",
  COMPOSE = "compose",
}

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

// Points to the AI alignment if the sections of a layer may not line up. A composed dataset
// combines existing datasets, so this is not suggested for it.
function NextStepHints({
  dataset,
  datasetAddType,
}: {
  dataset: APIDataset;
  datasetAddType: DatasetAddType;
}) {
  const activeUser = useWkSelector((state) => state.activeUser);
  if (datasetAddType === DatasetAddType.COMPOSE || !canRunAIAlignment(dataset, activeUser)) {
    return null;
  }
  return (
    <Typography.Paragraph>
      If something doesn&apos;t look right:
      <ul>
        <li>
          The sections of a layer are shifted against each other?{" "}
          <Link to={getViewDatasetUrlWithAIAlignment(dataset)}>Align them with AI</Link>
        </li>
      </ul>
    </Typography.Paragraph>
  );
}

// How often and how long the modal waits for the uploaded dataset to become active.
const DATASET_RELOAD_INTERVAL_MS = 2000;
const MAX_DATASET_LOAD_COUNT = 30;

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
  // The layers are only known once a dataset that needs a conversion is converted. Other datasets
  // can become active a moment after the upload finished, when the datastore reports their data
  // source, so the dataset is loaded again until it is active.
  const { data: dataset } = useQuery({
    queryKey: ["postUploadDataset", datasetId],
    queryFn: () => getDataset(datasetId),
    enabled: !datasetNeedsConversion,
    refetchInterval: (query) =>
      query.state.data?.isActive || query.state.dataUpdateCount >= MAX_DATASET_LOAD_COUNT
        ? false
        : DATASET_RELOAD_INTERVAL_MS,
  });
  console.log("dataset?.isActive", dataset?.isActive);
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
      {dataset?.isActive ? (
        <NextStepHints dataset={dataset} datasetAddType={datasetAddType} />
      ) : null}
    </Modal>
  );
}
