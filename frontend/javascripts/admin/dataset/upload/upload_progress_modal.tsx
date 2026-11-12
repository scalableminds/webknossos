import {
  CheckCircleFilled,
  CheckOutlined,
  CloseOutlined,
  RightOutlined,
  WarningOutlined,
} from "@ant-design/icons";
import { getDataset } from "admin/rest_api";
import { Alert, Avatar, Button, Divider, Flex, Modal, Typography, theme } from "antd";
import { formatBytes } from "libs/format_utils";
import { useQueryWithErrorHandling } from "libs/react_hooks";
import type React from "react";
import { useState } from "react";
import { useNavigate } from "react-router";
import { ModalWidth } from "theme";
import type { APIMaybeUnimportedDataset } from "types/api_types";
import {
  getDatasetThumbnailURL,
  getReadableURLPart,
  getViewDatasetURL,
} from "viewer/model/accessors/dataset_accessor";
import type { DatasetAddType } from "../dataset_add_type";
import { getDatasetLayerRows, type LayerRow } from "./upload_layers";
import {
  LayerList,
  MiddleEllipsisText,
  ProgressPanel,
  StageBar,
  ThumbnailPanel,
  TransferRateText,
} from "./upload_progress_components";
import { getStageStatuses, getStages, getUploadPhase } from "./upload_progress_stages";
import { useConversionJob } from "./use_conversion_job";
import type { UploadStatus } from "./use_resumable_dataset_upload";
import { useTransferRate } from "./use_transfer_rate";

type ActiveUploadStatus = Exclude<UploadStatus, { kind: "idle" }>;

const addAnotherLabel: Record<DatasetAddType, string> = {
  upload: "Upload another",
  remote: "Add another",
  compose: "Compose another",
};

/** The status of a dataset that was added without uploading it, i.e. a remote or composed one. */
export function getAddedDatasetStatus(datasetId: string, datasetName: string): UploadStatus {
  return {
    kind: "finished",
    datasetId,
    conversionJobId: null,
    datasetName,
    needsConversion: false,
    formatName: null,
    bytesTotal: 0,
    layers: [],
  };
}

function getBytesSent(status: ActiveUploadStatus): number {
  return status.kind === "uploading" || status.kind === "failed"
    ? status.bytesSent
    : status.bytesTotal;
}

function getUploadPercent(status: ActiveUploadStatus): number {
  if (status.bytesTotal === 0) return 100;
  // Floor, so that 100% is only shown once everything was sent.
  return Math.floor((getBytesSent(status) / status.bytesTotal) * 100);
}

function getProgressCaption(status: ActiveUploadStatus): string {
  const total = formatBytes(status.bytesTotal, 1);
  switch (status.kind) {
    case "uploading":
      return `${formatBytes(status.bytesSent, 1)} of ${total}`;
    case "finishing":
      return `${total} uploaded`;
    case "failed":
      return status.failedStage === "upload" ? "Upload failed" : `${total} uploaded`;
    case "finished":
      return "Upload complete";
  }
}

// Until the dataset is ready, only the uploaded files are known. Afterwards, the server's layers
// are listed, since they carry more details and differ from the uploaded ones after a conversion.
function getLayerRows(
  status: ActiveUploadStatus,
  dataset: APIMaybeUnimportedDataset | null,
): LayerRow[] {
  if (dataset == null || !("dataLayers" in dataset.dataSource)) return status.layers;
  return getDatasetLayerRows(dataset.dataSource.dataLayers, status.layers);
}

function FooterHint({ icon, children }: { icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <Typography.Text type="secondary">
      {icon} {children}
    </Typography.Text>
  );
}

function ReadyHeader() {
  const { token } = theme.useToken();
  return (
    <Flex gap={12} align="center" style={{ minWidth: 0 }}>
      <Avatar
        size={32}
        icon={<CheckOutlined />}
        style={{ flex: "none", background: token.colorSuccess }}
      />
      <Typography.Title level={4} style={{ margin: 0 }}>
        Your dataset is ready
      </Typography.Title>
    </Flex>
  );
}

function UploadProgressContent({
  status,
  datasetAddType,
  onCancelUpload,
  onClose,
}: {
  status: ActiveUploadStatus;
  datasetAddType: DatasetAddType;
  onCancelUpload: () => void;
  onClose: () => void;
}) {
  const { token } = theme.useToken();
  const navigate = useNavigate();
  const datasetId = status.kind === "finished" ? status.datasetId : null;
  const conversionJob = useConversionJob(
    status.kind === "finished" ? status.conversionJobId : null,
  );
  const phase = getUploadPhase(status, conversionJob);
  const isReady = phase.kind === "ready";
  const { data: dataset = null, isPending: isDatasetPending } = useQueryWithErrorHandling({
    queryKey: ["uploadedDataset", datasetId],
    queryFn: () => getDataset(datasetId as string),
    enabled: isReady && datasetId != null,
  });
  const transferRate = useTransferRate(
    getBytesSent(status),
    status.bytesTotal,
    status.kind === "uploading",
  );

  const uploadPercent = getUploadPercent(status);
  const datasetUrlPart = { name: status.datasetName, id: datasetId ?? "" };
  const layerRows = getLayerRows(status, dataset);
  const stages = getStages(datasetAddType, status.needsConversion);
  const closeOrCancel = phase.kind === "uploading" ? onCancelUpload : onClose;

  const bodyText =
    phase.kind === "finalizing"
      ? "All data is on the server. WEBKNOSSOS is now registering the dataset."
      : phase.kind === "converting"
        ? `Converting the ${status.formatName ?? "uploaded"} data into a format WEBKNOSSOS can display. This runs on the server and can take a while for large datasets.`
        : null;

  const renderFooter = () => {
    switch (phase.kind) {
      case "uploading":
        return [
          <FooterHint key="hint" icon={<WarningOutlined style={{ color: token.colorWarning }} />}>
            Keep this tab open until the upload finishes.
          </FooterHint>,
          <Button key="cancel" onClick={onCancelUpload}>
            Cancel upload
          </Button>,
        ];
      case "finalizing":
        return [<FooterHint key="hint">Almost done. Keep this tab open.</FooterHint>];
      case "converting":
        return [
          <FooterHint key="hint" icon={<CheckCircleFilled style={{ color: token.colorSuccess }} />}>
            You can close this tab. We'll email you when it's ready.
          </FooterHint>,
          <Button key="jobs" onClick={() => navigate("/jobs")}>
            View jobs
          </Button>,
        ];
      case "ready":
        return [
          <Typography.Link
            key="settings"
            onClick={() => navigate(`/datasets/${getReadableURLPart(datasetUrlPart)}/edit`)}
          >
            Dataset settings
          </Typography.Link>,
          <Flex key="actions" gap={8}>
            <Button onClick={onClose}>{addAnotherLabel[datasetAddType]}</Button>
            <Button
              type="primary"
              icon={<RightOutlined />}
              iconPlacement="end"
              onClick={() => navigate(getViewDatasetURL(datasetUrlPart))}
            >
              View dataset
            </Button>
          </Flex>,
        ];
      case "failed":
        return [
          <span key="hint" />,
          <Flex key="actions" gap={8}>
            {phase.stage === "convert" ? (
              <Button onClick={() => navigate("/jobs")}>View jobs</Button>
            ) : null}
            <Button onClick={onClose}>Close</Button>
          </Flex>,
        ];
    }
  };

  return (
    <Flex style={{ minHeight: 420 }}>
      <div style={{ width: 260, flex: "none" }}>
        {isReady ? (
          <ThumbnailPanel
            datasetName={status.datasetName}
            thumbnailUrl={dataset != null ? getDatasetThumbnailURL(dataset) : null}
            isLoading={isDatasetPending}
          />
        ) : (
          <ProgressPanel
            percent={uploadPercent}
            caption={getProgressCaption(status)}
            isUploading={status.kind === "uploading"}
            isProcessing={phase.kind === "finalizing" || phase.kind === "converting"}
          />
        )}
      </div>
      <Flex vertical gap={18} style={{ flex: 1, minWidth: 0, padding: token.paddingLG }}>
        <Flex gap={12} align="flex-start" justify="space-between">
          {isReady ? (
            <ReadyHeader />
          ) : (
            <MiddleEllipsisText
              text={status.datasetName}
              strong
              style={{ fontSize: token.fontSizeLG }}
            />
          )}
          {phase.kind !== "finalizing" ? (
            <Button
              type="text"
              size="small"
              aria-label="Close"
              icon={<CloseOutlined />}
              onClick={closeOrCancel}
            />
          ) : null}
        </Flex>

        <StageBar
          stages={stages}
          statuses={getStageStatuses(phase, stages)}
          uploadPercent={uploadPercent}
        />

        {bodyText != null ? (
          <Typography.Paragraph type="secondary" style={{ margin: 0 }}>
            {bodyText}
          </Typography.Paragraph>
        ) : null}
        {phase.kind === "failed" ? <Alert type="error" showIcon title={phase.message} /> : null}

        {layerRows.length > 0 ? (
          <LayerList
            layers={layerRows}
            isUploadStarting={status.kind === "uploading" && status.bytesSent === 0}
          />
        ) : null}

        {status.kind === "uploading" ? (
          <TransferRateText rate={transferRate} isRetrying={status.isRetrying} />
        ) : null}

        <Flex vertical style={{ marginTop: "auto" }}>
          <Divider style={{ marginTop: 0, marginBottom: 14 }} />
          <Flex justify="space-between" align="center" gap={8}>
            {renderFooter()}
          </Flex>
        </Flex>
      </Flex>
    </Flex>
  );
}

/**
 * Follows a dataset from the start of its upload until it is ready to be viewed: the upload
 * itself, the registration on the server and, if needed, the conversion job. Datasets that are
 * added without an upload (remote and composed ones) open directly in the ready state.
 */
export function UploadProgressModal({
  status,
  datasetAddType,
  onCancelUpload = () => {},
  onClose,
}: {
  status: UploadStatus;
  datasetAddType: DatasetAddType;
  onCancelUpload?: () => void;
  onClose: () => void;
}) {
  const { token } = theme.useToken();
  const isUploading = status.kind === "uploading";
  const isFinalizing = status.kind === "finishing";
  // Keep showing the last status while the modal animates out.
  const [displayedStatus, setDisplayedStatus] = useState<ActiveUploadStatus | null>(null);
  if (status.kind !== "idle" && status !== displayedStatus) setDisplayedStatus(status);
  return (
    <Modal
      open={status.kind !== "idle"}
      footer={null}
      closable={false}
      keyboard={!isFinalizing}
      mask={{ closable: false }}
      onCancel={isFinalizing ? undefined : isUploading ? onCancelUpload : onClose}
      width={ModalWidth.Large}
      destroyOnHidden
      styles={{
        container: { padding: 0, overflow: "hidden", borderRadius: token.borderRadiusLG },
      }}
    >
      {displayedStatus != null ? (
        <UploadProgressContent
          // Start from scratch (e.g. the conversion polling) for each dataset.
          key={displayedStatus.datasetName}
          status={displayedStatus}
          datasetAddType={datasetAddType}
          onCancelUpload={onCancelUpload}
          onClose={onClose}
        />
      ) : null}
    </Modal>
  );
}
