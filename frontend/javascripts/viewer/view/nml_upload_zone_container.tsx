import { FileOutlined, InboxOutlined } from "@ant-design/icons";
import { Alert, Avatar, Button, Checkbox, Flex, List, Modal, Spin } from "antd";
import FormattedDate from "components/formatted_date";
import { pluralize } from "libs/utils";
import prettyBytes from "pretty-bytes";
import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import Dropzone, { type DropzoneInputProps, useDropzone } from "react-dropzone";
import { useDispatch, useSelector } from "react-redux";
import { setDropzoneModalVisibilityAction } from "viewer/model/actions/ui_actions";
import type { WebknossosState } from "viewer/store";

const OverlayDropZone = ({ children }: { children: React.ReactNode }) => (
  <div className="nml-upload-zone-overlay">
    <div className="nml-upload-zone-modal">{children}</div>
  </div>
);

const NmlDropArea = ({
  isClickAllowed,
  isUpdateAllowed,
  getInputProps,
}: {
  isClickAllowed: boolean;
  isUpdateAllowed: boolean;
  getInputProps: (props?: DropzoneInputProps) => DropzoneInputProps;
}) => {
  return (
    <div style={{ textAlign: "center", cursor: "pointer" }}>
      {isClickAllowed && <input {...getInputProps()} />}
      <div>
        <InboxOutlined style={{ fontSize: 180, color: "var(--ant-color-primary)" }} />
      </div>
      <h5>
        {isUpdateAllowed
          ? `Drop NML or zip files here${isClickAllowed ? " or click to select files" : ""}...`
          : "Drop NML or zip files here to create a new annotation."}
      </h5>
    </div>
  );
};

const ImportModal = ({
  files,
  onCancel,
  onImport,
  isImporting,
  isUpdateAllowed,
  shouldCreateGroup,
  setShouldCreateGroup,
}: {
  files: File[];
  onCancel: () => void;
  onImport: () => void;
  isImporting: boolean;
  isUpdateAllowed: boolean;
  shouldCreateGroup: boolean;
  setShouldCreateGroup: (val: boolean) => void;
}) => {
  const newGroupMsg =
    files.length > 1
      ? "Create a new tree group for each file."
      : "Create a new tree group for this file.";

  return (
    <Modal
      title={`Import ${files.length} ${pluralize("Annotation", files.length)}`}
      open={files.length > 0}
      onCancel={onCancel}
      footer={
        <Flex justify="space-between" align="center">
          <Checkbox
            disabled={isImporting}
            onChange={(e) => setShouldCreateGroup(e.target.checked)}
            checked={shouldCreateGroup}
          >
            {newGroupMsg}
          </Checkbox>
          <Button key="submit" type="primary" onClick={onImport} disabled={isImporting}>
            {isUpdateAllowed ? "Import" : "Create New Annotation"}
          </Button>
        </Flex>
      }
    >
      <Spin spinning={isImporting}>
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
                    style={{ backgroundColor: "var(--ant-color-primary)" }}
                  />
                }
                title={
                  <span style={{ wordBreak: "break-word" }}>
                    {file.name}{" "}
                    <span className="ant-list-item-meta-description">
                      ({prettyBytes(file.size)})
                    </span>
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
      </Spin>
    </Modal>
  );
};

export default function NmlUploadZoneContainer({
  children,
  isUpdateAllowed,
  onImport,
}: {
  children: React.ReactNode;
  isUpdateAllowed: boolean;
  onImport: (files: File[], createGroupForEachFile: boolean) => Promise<void>;
}) {
  const [files, setFiles] = useState<File[]>([]);
  const [isImporting, setIsImporting] = useState(false);
  const [createGroupForEachFile, setCreateGroupForEachFile] = useState(true);
  const [createGroupForSingleFile, setCreateGroupForSingleFile] = useState(false);

  const showDropzoneModal = useSelector(
    (state: WebknossosState) => state.uiInformation.showDropzoneModal,
  );
  const navbarHeight = useSelector((state: WebknossosState) => state.uiInformation.navbarHeight);
  const dispatch = useDispatch();

  const hideDropzoneModal = useCallback(() => {
    dispatch(setDropzoneModalVisibilityAction(false));
  }, [dispatch]);

  const isMounted = useRef(false);
  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
    };
  }, []);

  const onDrop = useCallback(
    (droppedFiles: File[]) => {
      setFiles(droppedFiles);
      hideDropzoneModal();
    },
    [hideDropzoneModal],
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    noClick: true,
    noKeyboard: true,
    multiple: true,
    onDragEnter: (evt) => {
      // Check if dragged item is a file
      if (!evt.dataTransfer.types || evt.dataTransfer.types.indexOf("Files") === -1) {
        return;
      }
    },
  });

  const importTracingFiles = useCallback(async () => {
    setIsImporting(true);
    try {
      await onImport(files, files.length > 1 ? createGroupForEachFile : createGroupForSingleFile);
    } finally {
      if (isMounted.current) {
        setIsImporting(false);
        setFiles([]);
      }
    }
  }, [files, createGroupForEachFile, createGroupForSingleFile, onImport]);

  const shouldCreateGroup = files.length > 1 ? createGroupForEachFile : createGroupForSingleFile;
  const setShouldCreateGroup = (val: boolean) => {
    if (files.length > 1) {
      setCreateGroupForEachFile(val);
    } else {
      setCreateGroupForSingleFile(val);
    }
  };

  return (
    <div
      {...getRootProps()}
      style={{
        position: "relative",
        height: `calc(100vh - ${navbarHeight}px)`,
      }}
      className="flex-column"
    >
      <input {...getInputProps()} />
      {isDragActive && !showDropzoneModal && (
        <OverlayDropZone>
          <NmlDropArea
            isClickAllowed={false}
            isUpdateAllowed={isUpdateAllowed}
            getInputProps={getInputProps}
          />
        </OverlayDropZone>
      )}

      {showDropzoneModal && (
        <Modal open footer={null} onCancel={hideDropzoneModal}>
          {isUpdateAllowed && (
            <Alert
              title="Did you know that you can just drag-and-drop NML files directly into this view? You don't have to explicitly open this dialog first."
              style={{ marginBottom: 12 }}
            />
          )}
          <Dropzone multiple onDrop={onDrop}>
            {({ getRootProps: getModalRootProps, getInputProps: getModalInputProps }) => (
              <div {...getModalRootProps()}>
                <NmlDropArea
                  isClickAllowed
                  isUpdateAllowed={isUpdateAllowed}
                  getInputProps={getModalInputProps}
                />
              </div>
            )}
          </Dropzone>
        </Modal>
      )}

      <ImportModal
        files={files}
        onCancel={() => setFiles([])}
        onImport={importTracingFiles}
        isImporting={isImporting}
        isUpdateAllowed={isUpdateAllowed}
        shouldCreateGroup={shouldCreateGroup}
        setShouldCreateGroup={setShouldCreateGroup}
      />

      {children}
    </div>
  );
}
