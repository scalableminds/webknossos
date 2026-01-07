import { FileOutlined, InboxOutlined } from "@ant-design/icons";
import { Alert, Avatar, Button, Checkbox, Flex, List, Modal, Spin } from "antd";
import FormattedDate from "components/formatted_date";
import { pluralize } from "libs/utils";
import prettyBytes from "pretty-bytes";
import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import Dropzone, { type DropzoneInputProps } from "react-dropzone";
import { useDispatch, useSelector } from "react-redux";
import { setDropzoneModalVisibilityAction } from "viewer/model/actions/ui_actions";
import type { WebknossosState } from "viewer/store";

function OverlayDropZone({ children }: { children: React.ReactNode }) {
  return (
    <div className="nml-upload-zone-overlay">
      <div className="nml-upload-zone-modal">{children}</div>
    </div>
  );
}

function NmlDropArea({
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
  const [dropzoneActive, setDropzoneActive] = useState(false);
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

  // Mounted Ref
  const isMounted = useRef(false);
  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
    };
  }, []);

  const onDragEnter = useCallback((evt: React.DragEvent) => {
    const dt = evt.dataTransfer;

    if (!dt.types || dt.types.indexOf("Files") === -1) {
      // The dragged elements are not of type File. This happens when dragging trees or links.
      return;
    }

    setDropzoneActive(true);
  }, []);

  const onDragLeave = useCallback(() => {
    setDropzoneActive(false);
  }, []);

  const onDrop = useCallback(
    (droppedFiles: File[]) => {
      setFiles(droppedFiles);
      setDropzoneActive(false);
      hideDropzoneModal();
    },
    [hideDropzoneModal],
  );

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

  const renderNmlList = () => {
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
  };

  const renderDropzoneModal = () => {
    return (
      <Modal open footer={null} onCancel={hideDropzoneModal}>
        {isUpdateAllowed ? (
          <Alert
            title="Did you know that you do can just drag-and-drop NML files directly into this view? You don't have to explicitly open this dialog first."
            style={{
              marginBottom: 12,
            }}
          />
        ) : null}
        <Dropzone multiple onDrop={onDrop}>
          {({ getRootProps, getInputProps }) => (
            <div {...getRootProps()}>
              <NmlDropArea
                isClickAllowed
                isUpdateAllowed={isUpdateAllowed}
                getInputProps={getInputProps}
              />
            </div>
          )}
        </Dropzone>
      </Modal>
    );
  };

  const renderImportModal = () => {
    const newGroupMsg =
      files.length > 1
        ? "Create a new tree group for each file."
        : "Create a new tree group for this file.";

    return (
      <Modal
        title={`Import ${files.length} ${pluralize("Annotation", files.length)}`}
        open={files.length > 0}
        onCancel={() => setFiles([])}
        footer={
          <Flex justify="space-between">
            <Checkbox
              disabled={isImporting}
              onChange={(e) =>
                files.length > 1
                  ? setCreateGroupForEachFile(e.target.checked)
                  : setCreateGroupForSingleFile(e.target.checked)
              }
              checked={files.length > 1 ? createGroupForEachFile : createGroupForSingleFile}
            >
              {newGroupMsg}
            </Checkbox>
            <Button key="submit" type="primary" onClick={importTracingFiles} disabled={isImporting}>
              {isUpdateAllowed ? "Import" : "Create New Annotation"}
            </Button>
          </Flex>
        }
      >
        <Spin spinning={isImporting}>{renderNmlList()}</Spin>
      </Modal>
    );
  };

  // This react component wraps its children and lays a dropzone over them.
  // That way, files can be dropped over the entire view.
  return (
    <Dropzone
      noClick
      multiple
      onDrop={onDrop}
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      noKeyboard
    >
      {({ getRootProps, getInputProps }) => (
        <div
          {...getRootProps()}
          style={{
            position: "relative",
            height: `calc(100vh - ${navbarHeight}px)`,
          }}
          className="flex-column"
        >
          {
            // While dragging files over the view, the OverlayDropZone is rendered
            // which shows a hint to the user that he may drop files here.
          }
          {dropzoneActive && !showDropzoneModal ? (
            <OverlayDropZone>
              <NmlDropArea
                isClickAllowed={false}
                isUpdateAllowed={isUpdateAllowed}
                getInputProps={getInputProps}
              />
            </OverlayDropZone>
          ) : null}
          {
            // If the user explicitly selected the menu option to import NMLs,
            // we show a proper modal which renders almost the same hint ("You may drag... or click").
          }
          {showDropzoneModal ? renderDropzoneModal() : null}

          {
            // Once, files were dropped, we render the import modal
          }
          {renderImportModal()}

          {children}
        </div>
      )}
    </Dropzone>
  );
}
