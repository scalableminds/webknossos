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
        <h5>Drop NML or zip files here{isClickAllowed ? " or click to select files" : null}...</h5>
      ) : (
        <h5>
          Drop NML or zip files here to <b>create a new annotation</b>.
        </h5>
      )}
    </div>
  );
}

/**
 * Compact summary of the files that are about to be imported. Each row states what the
 * file actually is (size and modification time), so that the import can be sanity-checked
 * before it is confirmed.
 */
export function NmlFileList({ files }: { files: File[] }) {
  return (
    <List
      size="small"
      bordered
      dataSource={files}
      rowKey={(file) => `${file.name}-${file.lastModified}-${file.size}`}
      style={{
        maxHeight: 232,
        overflowY: "auto",
        background: "var(--ant-color-fill-quaternary)",
      }}
      renderItem={(file) => (
        <List.Item>
          <List.Item.Meta
            // Center the file icon next to the two text lines. Antd aligns the avatar to the
            // top of the item by default.
            style={{ alignItems: "center" }}
            avatar={
              <Avatar
                size={38}
                icon={<FileOutlined />}
                style={{
                  backgroundColor: "var(--ant-color-primary)",
                }}
              />
            }
            title={
              <Typography.Text strong ellipsis>
                {file.name}
              </Typography.Text>
            }
            description={
              <>
                {prettyBytes(file.size)} · modified <FormattedDate timestamp={file.lastModified} />
              </>
            }
          />
        </List.Item>
      )}
    />
  );
}
