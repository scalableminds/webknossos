import { FileOutlined, FolderOutlined, InboxOutlined, LoadingOutlined } from "@ant-design/icons";
import { Avatar, List, Modal, Progress, Spin, Typography } from "antd";
import classnames from "classnames";
import type React from "react";
import { type FileWithPath, useDropzone } from "react-dropzone";

// react-dropzone sets file.path (via file-selector::toFileWithPath), which the resumable upload uses.
export function FileDropzone({
  onDropAccepted,
  children,
}: {
  onDropAccepted: (files: FileWithPath[]) => void;
  children: React.ReactNode;
}) {
  const { getRootProps, getInputProps, isDragActive, isDragAccept, isDragReject } = useDropzone({
    onDropAccepted,
  });
  return (
    <div
      {...getRootProps({
        className: classnames("dataset-upload-dropzone", {
          "dataset-upload-dropzone-active": isDragActive,
          "dataset-upload-dropzone-accept": isDragAccept,
          "dataset-upload-dropzone-rejct": isDragReject,
        }),
      })}
    >
      <input {...getInputProps()} />
      <InboxOutlined style={{ fontSize: 48, color: "var(--ant-color-primary)" }} />
      <div
        style={{
          textAlign: "center",
          display: "inline-block",
          marginTop: 8,
          lineHeight: "1.7em",
        }}
      >
        {children}
      </div>
    </div>
  );
}

export function UploadedFileList({
  files,
  onRemove,
}: {
  files: FileWithPath[];
  onRemove: (file: FileWithPath) => void;
}) {
  if (files.length === 0) {
    return null;
  }
  const showSmallFileList = files.length > 10;
  return (
    <div style={{ marginTop: 8 }}>
      <Typography.Title level={5}>Files</Typography.Title>
      <div style={{ maxHeight: 600, overflowY: "auto" }}>
        <List
          itemLayout="horizontal"
          dataSource={files}
          size={showSmallFileList ? "small" : "default"}
          renderItem={(item: FileWithPath) => (
            <List.Item
              actions={[
                <a key="list-loadmore-edit" onClick={() => onRemove(item)}>
                  remove
                </a>,
              ]}
            >
              <List.Item.Meta
                avatar={
                  !showSmallFileList && (
                    <Avatar>
                      <FileOutlined />
                    </Avatar>
                  )
                }
                title={
                  <span>
                    {showSmallFileList && <FileOutlined />}{" "}
                    <span style={{ color: "darkgrey" }}>
                      {`${item.path?.split("/").slice(0, -1).join("/")}/`}
                    </span>
                    {item.name}
                  </span>
                }
              />
            </List.Item>
          )}
        />
      </div>
    </div>
  );
}

export function UploadProgressModal({
  title,
  label,
  isOpen,
  isFinishing,
  isRetrying,
  progress,
  onCancel,
}: {
  title: string;
  // E.g. "dataset my_dataset". Used as "Uploading <label>."
  label: string;
  isOpen: boolean;
  isFinishing: boolean;
  isRetrying: boolean;
  // Between 0 and 1.
  progress: number;
  onCancel: () => void;
}) {
  return (
    <Modal
      title={title}
      open={isOpen}
      keyboard={false}
      mask={{ closable: false }}
      footer={null}
      onCancel={onCancel}
    >
      <div style={{ display: "flex", alignItems: "center", flexDirection: "column" }}>
        {isFinishing ? (
          <>
            <Spin indicator={<LoadingOutlined style={{ fontSize: 48 }} spin />} />
            <br />
            Processing uploaded files …
          </>
        ) : (
          <>
            <FolderOutlined style={{ fontSize: 50, marginBottom: 8 }} />
            {isRetrying ? `Upload of ${label} froze.` : `Uploading ${label}.`}
            <br />
            {isRetrying ? "Retrying to continue the upload …" : null}
            <br />
            <Progress
              // Round to 1 digit after the comma, but use floor
              // to avoid that 100% are displayed even though the progress is lower.
              percent={Math.floor(progress * 1000) / 10}
              status="active"
            />
          </>
        )}
      </div>
    </Modal>
  );
}
