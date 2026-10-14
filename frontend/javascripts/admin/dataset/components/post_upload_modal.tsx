import { useQuery } from "@tanstack/react-query";
import { getDataset } from "admin/rest_api";
import { Alert, Button, Modal, Space, Typography } from "antd";
import { useWkSelector } from "libs/react_hooks";
import { Link, type useNavigate } from "react-router";
import { ModalWidth } from "theme";
import type { APIDataset } from "types/api_types";
import {
  getColorLayers,
  getReadableURLPart,
  getViewDatasetURL,
} from "viewer/model/accessors/dataset_accessor";
import {
  canRunAIAlignment,
  getViewDatasetUrlWithAIAlignment,
} from "viewer/view/ai_jobs/ai_job_url_param";
import { getLayerRegistrationListUrl } from "viewer/view/layer_registration/layer_registration_protocol";
import { DatasetAddType } from "../dataset_add_view";

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

// Points to the tools that fix sections or layers that don't line up. A composed dataset usually
// combines layers of different microscopes, so registering its layers is suggested more
// prominently.
function NextStepHints({
  dataset,
  datasetAddType,
  navigate,
}: {
  dataset: APIDataset;
  datasetAddType: DatasetAddType;
  navigate: ReturnType<typeof useNavigate>;
}) {
  const activeUser = useWkSelector((state) => state.activeUser);
  const canRegisterLayers = getColorLayers(dataset).length >= 2;
  const layerRegistrationListUrl = getLayerRegistrationListUrl(dataset);

  if (datasetAddType === DatasetAddType.COMPOSE) {
    return canRegisterLayers ? (
      <Alert
        type="info"
        showIcon
        title="Do the layers not line up yet?"
        description="Register them in WEBKNOSSOS: place matching landmarks in the layers side by side, check the result right away and apply it to the dataset."
        action={
          <Button size="small" onClick={() => navigate(layerRegistrationListUrl)}>
            Register Layers
          </Button>
        }
      />
    ) : null;
  }

  const canAlignSections = canRunAIAlignment(dataset, activeUser);
  if (!canRegisterLayers && !canAlignSections) {
    return null;
  }
  return (
    <Typography.Paragraph>
      If something doesn&apos;t look right:
      <ul>
        {canAlignSections ? (
          <li>
            The sections of a layer are shifted against each other?{" "}
            <Link to={getViewDatasetUrlWithAIAlignment(dataset)}>Align them with AI</Link>
          </li>
        ) : null}
        {canRegisterLayers ? (
          <li>
            The layers don&apos;t line up?{" "}
            <Link to={layerRegistrationListUrl}>Register them with landmarks</Link>
          </li>
        ) : null}
      </ul>
    </Typography.Paragraph>
  );
}

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
  // The layers are only known once a dataset that needs a conversion is converted.
  const { data: dataset } = useQuery({
    queryKey: ["postUploadDataset", datasetId],
    queryFn: () => getDataset(datasetId),
    enabled: !datasetNeedsConversion,
  });
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
        <NextStepHints dataset={dataset} datasetAddType={datasetAddType} navigate={navigate} />
      ) : null}
    </Modal>
  );
}
