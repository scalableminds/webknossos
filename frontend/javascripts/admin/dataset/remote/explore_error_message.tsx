import { CloseCircleOutlined, LockOutlined, RightOutlined } from "@ant-design/icons";
import { Alert, Button, Flex, Typography } from "antd";
import { useState } from "react";
import type { ExploreError, RemoteStorage } from "./remote_url_utils";

const PROTOCOL_ERROR =
  "This doesn't look like a dataset URL. Use an https://, s3:// or gs:// address that points to the dataset or layer root.";

function getErrorCopy(
  error: ExploreError,
  storage: RemoteStorage | null,
): { title: string; description: string } {
  const isBucket = storage === "s3" || storage === "gs";
  switch (error.kind) {
    case "access":
      return {
        title: "Couldn't read data at this URL",
        description: error.withCredentials
          ? "Access was denied with the given credentials. Check that they are correct and allow reading this data."
          : isBucket
            ? "The bucket refused access. If it is private, add access keys and try again. If it is public, check that the path points to the dataset folder."
            : "The server refused access. If the data is protected, add credentials and try again.",
      };
    case "notFound":
      return {
        title: "Nothing found at this URL",
        description:
          "Check that the address is spelled correctly and points to the dataset folder.",
      };
    case "request":
      return {
        title: "Couldn't explore this URL",
        description: error.message ?? "The request failed. Please try again.",
      };
    default:
      return {
        title: "No supported data found at this URL",
        description:
          "Make sure the URL points to the root of an OME-Zarr, Zarr, Zarr3, N5 or Neuroglancer Precomputed dataset or layer.",
      };
  }
}

/**
 * Explains why a URL couldn't be explored. A malformed URL gets a single line,
 * everything else an Alert with the explore report of the backend.
 */
export function ExploreErrorMessage({
  error,
  storage,
  hasCredentials,
  onAddCredentials,
  compact,
}: {
  error: ExploreError;
  storage: RemoteStorage | null;
  // Whether the credentials panel is open.
  hasCredentials: boolean;
  onAddCredentials?: () => void;
  // Used below the add row, where there is no room for an Alert.
  compact?: boolean;
}) {
  const [isReportOpen, setIsReportOpen] = useState(false);
  if (error.kind === "protocol") {
    return (
      <Typography.Text type="danger">
        <CloseCircleOutlined style={{ marginInlineEnd: 8 }} />
        {PROTOCOL_ERROR}
      </Typography.Text>
    );
  }

  const { title, description } = getErrorCopy(error, storage);
  const canAddCredentials = error.kind === "access" && !hasCredentials && onAddCredentials != null;
  const actions =
    canAddCredentials || error.report != null ? (
      <Flex vertical align="flex-start" gap={4}>
        <Flex gap="middle" wrap>
          {canAddCredentials ? (
            <Button type="link" size="small" icon={<LockOutlined />} onClick={onAddCredentials}>
              {storage === "s3" ? "Add access keys" : "Add credentials"}
            </Button>
          ) : null}
          {error.report != null ? (
            <Button
              type="link"
              size="small"
              icon={
                <RightOutlined rotate={isReportOpen ? 90 : 0} className="dataset-remote-chevron" />
              }
              onClick={() => setIsReportOpen(!isReportOpen)}
            >
              Technical details
            </Button>
          ) : null}
        </Flex>
        {isReportOpen && error.report != null ? (
          <pre className="dataset-remote-report">{error.report}</pre>
        ) : null}
      </Flex>
    ) : null;

  if (compact) {
    return (
      <Flex vertical align="flex-start" gap={4}>
        <Typography.Text type="danger">
          {title}. {description}
        </Typography.Text>
        {actions}
      </Flex>
    );
  }

  return (
    <Alert
      type="error"
      showIcon
      title={title}
      description={
        <Flex vertical gap={4}>
          <Typography.Text type="secondary">{description}</Typography.Text>
          {actions}
        </Flex>
      }
    />
  );
}
