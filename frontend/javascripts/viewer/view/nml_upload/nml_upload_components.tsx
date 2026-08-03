import { FileOutlined, InboxOutlined } from "@ant-design/icons";
import { Avatar, List, Typography } from "antd";
import FormattedDate from "components/formatted_date";
import prettyBytes from "pretty-bytes";
import type { DropzoneInputProps } from "react-dropzone";

export function NmlDropzoneContent({
  isClickAllowed,
  isUpdateAllowed,
  getInputProps,
}: {
  isClickAllowed: boolean;
  isUpdateAllowed: boolean;
  getInputProps: (props?: DropzoneInputProps) => DropzoneInputProps;
}) {
  const clickInput = isClickAllowed ? <input {...getInputProps()} /> : null;
  return (
    <div
      style={{
        textAlign: "center",
        cursor: "pointer",
      }}
    >
      {clickInput}
      <div>
        <InboxOutlined
          style={{
            fontSize: 180,
            color: "var(--ant-color-primary)",
          }}
        />
      </div>
      {isUpdateAllowed ? (
        <Typography.Title level={5}>
          Drop NML or zip files here{isClickAllowed ? " or click to select files" : null}...
        </Typography.Title>
      ) : (
        <Typography.Title level={5}>
          Drop NML or zip files here to <b>create a new annotation</b>.
        </Typography.Title>
      )}
    </div>
  );
}

export function NmlList({ files }: { files: File[] }) {
  return (
    <List
      itemLayout="horizontal"
      dataSource={files}
      renderItem={(file: File) => (
        <List.Item>
          <List.Item.Meta
            avatar={
              <Avatar
                size="large"
                icon={<FileOutlined />}
                style={{
                  backgroundColor: "var(--ant-color-primary)",
                }}
              />
            }
            title={
              <span
                style={{
                  wordBreak: "break-word",
                }}
              >
                {file.name}{" "}
                <span className="ant-list-item-meta-description">({prettyBytes(file.size)})</span>
              </span>
            }
            description={
              <span>
                Last modified: <FormattedDate timestamp={file.lastModified} />
              </span>
            }
          />
        </List.Item>
      )}
    />
  );
}
