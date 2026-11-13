import { LockOutlined, UploadOutlined } from "@ant-design/icons";
import { Col, Flex, Input, Row, Segmented, Tag, Typography, Upload } from "antd";
import { useWkSelector } from "libs/react_hooks";
import {
  getCredentialFieldLabels,
  getCredentialsTitle,
  type HttpsAuthMode,
  type RemoteCredentialsInput,
} from "./remote_credentials";
import type { RemoteStorage } from "./remote_url_utils";

function CredentialField({
  label,
  children,
}: {
  label: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Flex vertical gap={8}>
      <Typography.Text>{label}</Typography.Text>
      {children}
    </Flex>
  );
}

function ServiceAccountKeyDropzone({
  value,
  onChange,
}: {
  value: RemoteCredentialsInput;
  onChange: (value: RemoteCredentialsInput) => void;
}) {
  return (
    <Upload.Dragger
      className="dataset-remote-key-dropzone"
      accept=".json,application/json"
      maxCount={1}
      fileList={value.serviceAccountKeyFiles}
      beforeUpload={() => false}
      onChange={(info) => onChange({ ...value, serviceAccountKeyFiles: info.fileList.slice(-1) })}
    >
      <Flex align="center" gap="middle">
        <UploadOutlined className="dataset-remote-key-dropzone-icon" />
        <Flex vertical align="flex-start">
          <span>
            Drop the{" "}
            <a
              href="https://cloud.google.com/iam/docs/creating-managing-service-account-keys"
              target="_blank"
              rel="noopener noreferrer"
              onClick={(event) => event.stopPropagation()}
            >
              service account
            </a>{" "}
            key here, or <Typography.Link>choose a file</Typography.Link>
          </span>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            JSON key with read access to the bucket
          </Typography.Text>
        </Flex>
      </Flex>
    </Upload.Dragger>
  );
}

function UsernamePasswordFields({
  storage,
  value,
  onChange,
}: {
  storage: RemoteStorage | null;
  value: RemoteCredentialsInput;
  onChange: (value: RemoteCredentialsInput) => void;
}) {
  const labels = getCredentialFieldLabels(storage);
  return (
    <Row gutter={24}>
      <Col xs={24} md={12}>
        <CredentialField label={labels.username}>
          <Input
            className="dataset-remote-mono"
            autoComplete="off"
            value={value.usernameOrAccessKey}
            placeholder={storage === "s3" ? "AKIA…" : undefined}
            onChange={(event) => onChange({ ...value, usernameOrAccessKey: event.target.value })}
          />
        </CredentialField>
      </Col>
      <Col xs={24} md={12}>
        <CredentialField label={labels.password}>
          <Input.Password
            className="dataset-remote-mono"
            autoComplete="new-password"
            value={value.passwordOrSecretKey}
            onChange={(event) => onChange({ ...value, passwordOrSecretKey: event.target.value })}
          />
        </CredentialField>
      </Col>
    </Row>
  );
}

const HTTPS_AUTH_MODE_OPTIONS: Array<{ value: HttpsAuthMode; label: React.ReactNode }> = [
  { value: "basic", label: "Basic authentication" },
  {
    value: "token",
    label: (
      <>
        X-Auth-Token <Tag style={{ marginInline: 4 }}>Super user</Tag>
      </>
    ),
  },
];

/** Credentials for a private bucket or a protected web server, matching the storage of the URL. */
export function RemoteCredentialsPanel({
  storage,
  value,
  onChange,
}: {
  storage: RemoteStorage | null;
  value: RemoteCredentialsInput;
  onChange: (value: RemoteCredentialsInput) => void;
}) {
  const isSuperUser = useWkSelector((state) => state.activeUser?.isSuperUser ?? false);
  const canUseXAuthToken = storage === "https" && isSuperUser;
  const usesXAuthToken = canUseXAuthToken && value.httpsAuthMode === "token";

  return (
    <Flex vertical gap="middle" className="dataset-remote-credentials">
      <Flex justify="space-between" align="baseline" gap="middle" wrap>
        <Typography.Text strong>
          <LockOutlined className="dataset-remote-accent-icon" />
          {usesXAuthToken ? "X-Auth-Token" : getCredentialsTitle(storage)}
        </Typography.Text>
        <Typography.Text type="secondary">
          Stored encrypted and used only to read this data.
        </Typography.Text>
      </Flex>
      {canUseXAuthToken ? (
        <Segmented<HttpsAuthMode>
          options={HTTPS_AUTH_MODE_OPTIONS}
          value={value.httpsAuthMode}
          onChange={(httpsAuthMode) => onChange({ ...value, httpsAuthMode })}
          style={{ alignSelf: "flex-start" }}
        />
      ) : null}
      {storage === "gs" ? (
        <ServiceAccountKeyDropzone value={value} onChange={onChange} />
      ) : usesXAuthToken ? (
        <CredentialField label="Token">
          <Input.Password
            className="dataset-remote-mono"
            autoComplete="off"
            value={value.xAuthToken}
            onChange={(event) => onChange({ ...value, xAuthToken: event.target.value })}
          />
        </CredentialField>
      ) : (
        <UsernamePasswordFields storage={storage} value={value} onChange={onChange} />
      )}
    </Flex>
  );
}
