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
import {
  LayerList,
  type LayerRow,
  MiddleEllipsisText,
  ProgressPanel,
  StageBar,
  ThumbnailPanel,
  TransferRateText,
} from "./upload_progress_components";
import { getStageStatuses, getUploadPhase } from "./upload_progress_stages";
import { useConversionJob } from "./use_conversion_job";
import type { UploadStatus } from "./use_resumable_dataset_upload";
import { useTransferRate } from "./use_transfer_rate";

type ActiveUploadStatus = Exclude<UploadStatus, { kind: "idle" }>;

// Remote and composed datasets skip the upload pipeline and are ready right away.
const hasUploadPipeline: Record<DatasetAddType, boolean> = {
  upload: true,
  remote: false,
  compose: false,
};

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

function getLayerRows(status: ActiveUploadStatus, dataset: APIMaybeUnimportedDataset | null) {
  if (status.layers.length > 0) return status.layers;
  // Added datasets have no upload progress, so their layers are listed without sizes.
  if (dataset == null || !("dataLayers" in dataset.dataSource)) return [];
  return dataset.dataSource.dataLayers.map(
    (layer): LayerRow => ({ name: layer.name, bytes: null, sentBytes: null }),
  );
}

function FooterHint({ icon, children }: { icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <Typography.Text type="secondary">
      {icon} {children}
    </Typography.Text>
  );
}

function ReadyHeader({ datasetName }: { datasetName: string }) {
  const { token } = theme.useToken();
  return (
    <Flex gap={12} align="flex-start" style={{ minWidth: 0 }}>
      <Avatar
        size={32}
        icon={<CheckOutlined />}
        style={{ flex: "none", background: token.colorSuccess }}
      />
      <Flex vertical style={{ minWidth: 0 }}>
        <Typography.Title level={4} style={{ margin: 0 }}>
          Your dataset is ready
        </Typography.Title>
        <MiddleEllipsisText text={datasetName} type="secondary" />
      </Flex>
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
  const conversionJob = useConversionJob(status.needsConversion ? datasetId : null);
  const phase = getUploadPhase(status, conversionJob);
  const isReady = phase.kind === "ready";
  const { data: dataset = null } = useQueryWithErrorHandling({
    queryKey: ["uploadedDataset", datasetId],
    queryFn: () => getDataset(datasetId as string),
    enabled: isReady && datasetId != null,
  });
  const transferRate = useTransferRate(getBytesSent(status), status.bytesTotal);

  const uploadPercent = getUploadPercent(status);
  const datasetUrlPart = { name: status.datasetName, id: datasetId ?? "" };
  const layerRows = getLayerRows(status, dataset);
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
          <ThumbnailPanel thumbnailUrl={dataset != null ? getDatasetThumbnailURL(dataset) : null} />
        ) : (
          <ProgressPanel
            percent={uploadPercent}
            caption={getProgressCaption(status)}
            isProcessing={phase.kind === "finalizing" || phase.kind === "converting"}
          />
        )}
      </div>
      <Flex vertical gap={18} style={{ flex: 1, minWidth: 0, padding: token.paddingLG }}>
        <Flex gap={12} align="flex-start" justify="space-between">
          {isReady ? (
            <ReadyHeader datasetName={status.datasetName} />
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

        {hasUploadPipeline[datasetAddType] ? (
          <StageBar
            statuses={getStageStatuses(phase, status.needsConversion)}
            uploadPercent={uploadPercent}
            needsConversion={status.needsConversion}
          />
        ) : null}

        {bodyText != null ? (
          <Typography.Paragraph type="secondary" style={{ margin: 0 }}>
            {bodyText}
          </Typography.Paragraph>
        ) : null}
        {phase.kind === "failed" ? <Alert type="error" showIcon title={phase.message} /> : null}

        {layerRows.length > 0 ? <LayerList layers={layerRows} /> : null}

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
