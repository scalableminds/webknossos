import { CheckCircleFilled, CheckOutlined, CloseCircleOutlined } from "@ant-design/icons";
import {
  Badge,
  Col,
  ConfigProvider,
  Divider,
  Flex,
  Image,
  Progress,
  Row,
  Statistic,
  Typography,
  theme,
} from "antd";
import dayjs from "dayjs";
import { formatBytes } from "libs/format_utils";
import type React from "react";
import { useState } from "react";
import { getAntdTheme } from "theme";
import { getStages, type Stage, type StageStatus } from "./upload_progress_stages";
import type { TransferRate } from "./use_transfer_rate";

const GRID_SIZE = 6;
const BLOCK_COUNT = GRID_SIZE * GRID_SIZE;
const BAR_SIZE = { height: 4 };
const TABULAR_NUMBERS: React.CSSProperties = { fontVariantNumeric: "tabular-nums" };

const STAGE_LABELS: Record<Stage, string> = {
  upload: "Upload",
  finalize: "Finalize",
  convert: "Convert",
  ready: "Ready",
};

// Keeps the end of long names visible, since names often only differ in a suffix
// (e.g. …_round1_volume5). The tail is the part after the last underscore, if it is short.
function splitForMiddleEllipsis(text: string): [head: string, tail: string] {
  const underscoreIndex = text.lastIndexOf("_");
  const tailLength =
    underscoreIndex > 0 && text.length - underscoreIndex <= 12 ? text.length - underscoreIndex : 8;
  if (text.length <= 2 * tailLength) return [text, ""];
  return [text.slice(0, -tailLength), text.slice(-tailLength)];
}

export function MiddleEllipsisText({
  text,
  ...textProps
}: { text: string } & React.ComponentProps<typeof Typography.Text>) {
  const [head, tail] = splitForMiddleEllipsis(text);
  return (
    <Flex style={{ minWidth: 0 }}>
      <Typography.Text {...textProps} ellipsis={{ tooltip: text }}>
        {head}
      </Typography.Text>
      <Typography.Text {...textProps} style={{ ...textProps.style, flex: "none" }}>
        {tail}
      </Typography.Text>
    </Flex>
  );
}

/**
 * A chunky picture of the overall progress: each block stands for 1/36 of the data. The blocks
 * are no real data chunks. The block that is being uploaded breathes. While the server works on
 * the data (isProcessing), a breathing wave runs across the whole grid instead.
 */
function ProgressGrid({
  percent,
  isSuccess,
  isProcessing,
}: {
  percent: number;
  isSuccess?: boolean;
  isProcessing?: boolean;
}) {
  const { token } = theme.useToken();
  const filledBlockCount = Math.floor((percent / 100) * BLOCK_COUNT);
  const isCurrentBlock = (index: number) =>
    index === filledBlockCount && percent > 0 && percent < 100;
  const getColor = (index: number) => {
    if (index < filledBlockCount) return isSuccess ? token.colorSuccess : token.colorPrimary;
    if (isCurrentBlock(index)) return token.colorPrimaryText;
    return token.colorFillSecondary;
  };
  const isBreathing = (index: number) => (isProcessing ? !isSuccess : isCurrentBlock(index));
  return (
    <Row gutter={[6, 6]}>
      {Array.from({ length: BLOCK_COUNT }, (_, index) => (
        <Col key={index} span={24 / GRID_SIZE}>
          <div
            className={isBreathing(index) ? "upload-progress-block-breathing" : undefined}
            style={{
              aspectRatio: 1,
              borderRadius: token.borderRadius,
              background: getColor(index),
              transition: `background ${token.motionDurationMid} ${token.motionEaseOut}`,
              // Offsets the blocks along the diagonals, so that the wave runs across the grid.
              animationDelay: isProcessing
                ? `${((index % GRID_SIZE) + Math.floor(index / GRID_SIZE)) * 120}ms`
                : undefined,
            }}
          />
        </Col>
      ))}
    </Row>
  );
}

type ProgressPanelProps = { percent: number; caption: string; isProcessing: boolean };

function ProgressPanelContent({ percent, caption, isProcessing }: ProgressPanelProps) {
  // Rendered inside the dark theme (see ProgressPanel), so all tokens are the dark ones.
  const { token } = theme.useToken();
  return (
    <Flex
      vertical
      gap={20}
      style={{ height: "100%", padding: token.paddingLG, background: token.colorBgContainer }}
    >
      <ProgressGrid percent={percent} isProcessing={isProcessing} />
      <Flex vertical gap={2} style={{ marginTop: "auto" }}>
        <Statistic
          value={percent}
          suffix="%"
          styles={{
            content: {
              ...TABULAR_NUMBERS,
              fontSize: 40,
              fontWeight: 700,
              lineHeight: 1,
              color: token.colorTextHeading,
            },
            suffix: { marginInlineStart: 0 },
          }}
        />
        <Typography.Text type="secondary" style={TABULAR_NUMBERS}>
          {caption}
        </Typography.Text>
      </Flex>
    </Flex>
  );
}

// The panel is dark in both the light and the dark app theme.
export function ProgressPanel(props: ProgressPanelProps) {
  return (
    <ConfigProvider theme={getAntdTheme("dark")}>
      <ProgressPanelContent {...props} />
    </ConfigProvider>
  );
}

/** Shows the dataset's thumbnail, or a completed grid if there is none (yet). */
export function ThumbnailPanel({ thumbnailUrl }: { thumbnailUrl: string | null }) {
  const [hasFailed, setHasFailed] = useState(false);
  if (thumbnailUrl == null || hasFailed) {
    return (
      <ConfigProvider theme={getAntdTheme("dark")}>
        <ThumbnailFallback />
      </ConfigProvider>
    );
  }
  return (
    <Image
      src={thumbnailUrl}
      alt="Dataset thumbnail"
      preview={false}
      styles={{
        root: { display: "block", width: "100%", height: "100%" },
        image: { width: "100%", height: "100%", objectFit: "cover" },
      }}
      onError={() => setHasFailed(true)}
    />
  );
}

function ThumbnailFallback() {
  const { token } = theme.useToken();
  return (
    <div style={{ height: "100%", padding: token.paddingLG, background: token.colorBgContainer }}>
      <ProgressGrid percent={100} isSuccess />
    </div>
  );
}

function StageLabel({ stage, status }: { stage: Stage; status: StageStatus }) {
  const label = STAGE_LABELS[stage];
  switch (status) {
    case "active":
      return (
        <Typography.Text strong className="upload-progress-stage-breathing">
          {label}
        </Typography.Text>
      );
    case "done":
      return (
        <Typography.Text>
          <Typography.Text type="success">
            <CheckOutlined />
          </Typography.Text>{" "}
          {label}
        </Typography.Text>
      );
    case "error":
      return (
        <Typography.Text type="danger" strong>
          <CloseCircleOutlined /> {label}
        </Typography.Text>
      );
    default:
      return <Typography.Text type="secondary">{label}</Typography.Text>;
  }
}

function StageBarItem({
  stage,
  status,
  percent,
}: {
  stage: Stage;
  status: StageStatus;
  // Only known while uploading. All other stages run on the server without progress reports.
  percent: number | null;
}) {
  const progressProps: React.ComponentProps<typeof Progress> =
    status === "active"
      ? { percent: percent ?? 100, status: "active" }
      : status === "done"
        ? { percent: 100, status: "success" }
        : status === "error"
          ? { percent: 100, status: "exception" }
          : { percent: 0 };
  return (
    <Flex vertical gap={6}>
      <Progress {...progressProps} size={BAR_SIZE} showInfo={false} />
      <StageLabel stage={stage} status={status} />
    </Flex>
  );
}

export function StageBar({
  statuses,
  uploadPercent,
  needsConversion,
}: {
  statuses: Record<Stage, StageStatus>;
  uploadPercent: number;
  needsConversion: boolean;
}) {
  const stages = getStages(needsConversion);
  return (
    <Row gutter={6}>
      {stages.map((stage) => (
        <Col key={stage} span={24 / stages.length}>
          <StageBarItem
            stage={stage}
            status={statuses[stage]}
            percent={stage === "upload" ? uploadPercent : null}
          />
        </Col>
      ))}
    </Row>
  );
}

export type LayerRow = { name: string; bytes: number | null; sentBytes: number | null };

function LayerStatusIcon({ status }: { status: "pending" | "uploading" | "done" }) {
  const { token } = theme.useToken();
  if (status === "done") {
    return (
      <Typography.Text type="success">
        <CheckCircleFilled />
      </Typography.Text>
    );
  }
  // The layer's progress bar already shows that it is uploading, so a plain dot suffices.
  return status === "uploading" ? <Badge color={token.colorPrimary} /> : <Badge status="default" />;
}

function getLayerStatus(layer: LayerRow): "pending" | "uploading" | "done" {
  if (layer.bytes == null || layer.sentBytes == null || layer.sentBytes >= layer.bytes) {
    return "done";
  }
  return layer.sentBytes > 0 ? "uploading" : "pending";
}

function LayerListItem({ layer }: { layer: LayerRow }) {
  const { token } = theme.useToken();
  const status = getLayerStatus(layer);
  return (
    <Flex vertical gap={8} style={{ padding: `${token.paddingXS + 2}px ${token.paddingSM}px` }}>
      <Flex align="center" gap={10}>
        <LayerStatusIcon status={status} />
        <Typography.Text strong={status === "uploading"} ellipsis style={{ flex: 1 }}>
          {layer.name}
        </Typography.Text>
        {layer.bytes != null ? (
          <Typography.Text type="secondary" style={TABULAR_NUMBERS}>
            {formatBytes(layer.bytes, 1)}
          </Typography.Text>
        ) : null}
      </Flex>
      {status === "uploading" && layer.bytes != null && layer.sentBytes != null ? (
        <Progress
          percent={(layer.sentBytes / layer.bytes) * 100}
          size={BAR_SIZE}
          showInfo={false}
          style={{ paddingInlineStart: 24 }}
        />
      ) : null}
    </Flex>
  );
}

export function LayerList({ layers }: { layers: LayerRow[] }) {
  const { token } = theme.useToken();
  return (
    <Flex
      vertical
      style={{
        maxHeight: 240,
        overflowY: "auto",
        border: `1px solid ${token.colorBorderSecondary}`,
        borderRadius: token.borderRadiusLG,
      }}
    >
      {layers.map((layer, index) => (
        <div key={layer.name}>
          {index > 0 ? <Divider style={{ margin: 0 }} /> : null}
          <LayerListItem layer={layer} />
        </div>
      ))}
    </Flex>
  );
}

export function TransferRateText({
  rate,
  isRetrying,
}: {
  rate: TransferRate | null;
  isRetrying: boolean;
}) {
  if (isRetrying) {
    return (
      <Typography.Text type="warning">The upload froze. Retrying to continue …</Typography.Text>
    );
  }
  if (rate == null) return null;
  return (
    <Typography.Text type="secondary" style={TABULAR_NUMBERS}>
      <Typography.Text strong>{formatBytes(rate.bytesPerSecond, 1)}/s</Typography.Text>
      {rate.secondsLeft != null
        ? ` · about ${dayjs.duration(rate.secondsLeft, "seconds").humanize()} left`
        : null}
    </Typography.Text>
  );
}
