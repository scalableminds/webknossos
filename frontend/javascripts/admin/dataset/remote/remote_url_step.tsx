import { LinkOutlined, LockOutlined, PlusOutlined } from "@ant-design/icons";
import { Button, Flex, Input, Tag, Typography } from "antd";
import { ExploreErrorMessage } from "./explore_error_message";
import { getCredentialsLinkLabel } from "./remote_credentials";
import { RemoteCredentialsPanel } from "./remote_credentials_panel";
import { type RemoteFormat, STORAGE_LABELS, SUPPORTED_FORMATS } from "./remote_url_utils";
import type { RemoteUrlField } from "./use_remote_url_field";

export const ADD_LAYERS_LABEL = "Add layers";
export const EXPLORING_LABEL = "Reading…";

function SupportedFormatTags({ detectedFormat }: { detectedFormat: RemoteFormat | null }) {
  return (
    <Flex wrap gap={8} align="center">
      <Typography.Text type="secondary">Works with</Typography.Text>
      {SUPPORTED_FORMATS.map((format) => (
        <Tag
          key={format}
          variant="outlined"
          color={format === detectedFormat ? "processing" : undefined}
          className="dataset-remote-format-tag"
        >
          {format}
        </Tag>
      ))}
    </Flex>
  );
}

/** The first step: one URL field and one button. */
export function RemoteUrlStep({
  field,
  onSubmit,
}: {
  field: RemoteUrlField;
  onSubmit: () => void;
}) {
  const { url, storage, error, isExploring, isCredentialsOpen } = field;
  return (
    <Flex vertical>
      <div style={{ paddingBottom: 8 }}>
        <label htmlFor="remote-dataset-url" className="dataset-remote-required-label">
          Dataset URL
        </label>
      </div>
      <Flex gap={8}>
        <Input
          id="remote-dataset-url"
          className="dataset-remote-url-input"
          size="large"
          autoFocus
          value={url}
          status={error != null ? "error" : undefined}
          placeholder="s3://, gs:// or https:// URL of a dataset or a single layer"
          prefix={<LinkOutlined className="dataset-remote-accent-icon" />}
          // Always render a suffix: adding one while typing would remount the input and drop focus.
          suffix={
            storage != null ? (
              <Tag color="processing" variant="filled" style={{ marginInlineEnd: 0 }}>
                {STORAGE_LABELS[storage]}
              </Tag>
            ) : (
              <span />
            )
          }
          onChange={(event) => field.setUrl(event.target.value)}
          onPressEnter={onSubmit}
        />
        <Button
          type="primary"
          size="large"
          className="dataset-remote-url-button"
          icon={<PlusOutlined />}
          loading={isExploring}
          onClick={onSubmit}
        >
          {isExploring ? EXPLORING_LABEL : ADD_LAYERS_LABEL}
        </Button>
      </Flex>
      {error != null ? (
        <div style={{ marginTop: error.kind === "protocol" ? 8 : 12 }}>
          <ExploreErrorMessage
            error={error}
            storage={storage}
            hasCredentials={isCredentialsOpen}
            onAddCredentials={field.openCredentials}
          />
        </div>
      ) : null}
      <Flex justify="space-between" align="center" gap="middle" wrap style={{ marginTop: 12 }}>
        <SupportedFormatTags detectedFormat={field.format} />
        <Button type="link" icon={<LockOutlined />} onClick={field.toggleCredentials}>
          {isCredentialsOpen ? "Remove credentials" : getCredentialsLinkLabel(storage)}
        </Button>
      </Flex>
      {isCredentialsOpen ? (
        <div style={{ marginTop: 16 }}>
          <RemoteCredentialsPanel
            storage={storage}
            value={field.credentials}
            onChange={field.setCredentials}
          />
        </div>
      ) : null}
    </Flex>
  );
}
