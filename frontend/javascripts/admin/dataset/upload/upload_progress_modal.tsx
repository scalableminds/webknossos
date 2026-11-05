import { FolderOutlined, LoadingOutlined } from "@ant-design/icons";
import { Flex, Modal, Progress, Spin, Typography } from "antd";
import type { UploadStatus } from "./use_resumable_upload";

export function UploadProgressModal({
  status,
  onCancel,
  title = "Dataset Upload",
  uploadingLabel = "Uploading dataset",
}: {
  status: UploadStatus;
  onCancel: () => void;
  title?: string;
  uploadingLabel?: string;
}) {
  return (
    <Modal
      title={title}
      open={status.kind !== "idle"}
      keyboard={false}
      mask={{ closable: false }}
      footer={null}
      onCancel={onCancel}
    >
      <Flex vertical align="center" gap="small">
        {status.kind === "finishing" ? (
          <>
            <Spin indicator={<LoadingOutlined style={{ fontSize: 48 }} spin />} />
            Processing uploaded files …
          </>
        ) : status.kind === "uploading" ? (
          <>
            <FolderOutlined style={{ fontSize: 50 }} />
            <div style={{ width: "100%", textAlign: "center" }}>
              {status.isRetrying ? "The upload froze. Retrying to continue …" : uploadingLabel}
              <Typography.Text strong style={{ display: "block", overflowWrap: "anywhere" }}>
                {status.name}
              </Typography.Text>
            </div>
            <Progress
              // Round to 1 digit after the comma, but use floor
              // to avoid that 100% are displayed even though the progress is lower.
              percent={Math.floor(status.progress * 1000) / 10}
              status="active"
            />
          </>
        ) : null}
      </Flex>
    </Modal>
  );
}
