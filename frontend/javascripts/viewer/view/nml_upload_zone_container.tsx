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

/**
 * Renders an overlay on top of the children to indicate that a file can be dropped.
 */
const OverlayDropZone = ({ children }: { children: React.ReactNode }) => (
  <div className="nml-upload-zone-overlay">
    <div className="nml-upload-zone-modal">{children}</div>
  </div>
);

/**
 * Renders the drop area content (icon and text) within the Dropzone or Modal.
 */
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
    <div style={{ textAlign: "center", cursor: "pointer", padding: "20px" }}>
      {isClickAllowed && <input {...getInputProps()} />}
      <div>
        <InboxOutlined
          style={{
            fontSize: 180,
            color: "var(--ant-color-primary)",
          }}
        />
      </div>
      <h5>
        {isUpdateAllowed
          ? `Drop NML or zip files here${isClickAllowed ? " or click to select files" : ""}...`
          : "Drop NML or zip files here to create a new annotation."}
      </h5>
    </div>
  );
};

/**
 * Modal that handles file import operations.
 * Allows reviewing dropped files, selecting import options, and initiating the import.
 */
const UploadModal = ({
  files,
  onCancel,
  onImport,
  isImporting,
  isUpdateAllowed,
  shouldCreateGroup,
  setShouldCreateGroup,
  onDrop,
}: {
  files: File[];
  onCancel: () => void;
  onImport: () => void;
  isImporting: boolean;
  isUpdateAllowed: boolean;
  shouldCreateGroup: boolean;
  setShouldCreateGroup: (val: boolean) => void;
  onDrop: (files: File[]) => void;
}) => {
  const hasFiles = files.length > 0;

  const newGroupMsg =
    files.length > 1
      ? "Create a new tree group for each file."
      : "Create a new tree group for this file.";

  const footer = hasFiles ? (
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
  ) : null;

  return (
    <Modal
      title={
        hasFiles
          ? `Import ${files.length} ${pluralize("Annotation", files.length)}`
          : "Import Annotations"
      }
      open={true}
      onCancel={onCancel}
      footer={footer}
    >
      <Dropzone multiple onDrop={onDrop} noClick={hasFiles} noKeyboard>
        {({ getRootProps, getInputProps }) => (
          <div {...getRootProps()}>
            {!hasFiles && isUpdateAllowed && (
              <Alert
                title="Did you know that you can just drag-and-drop NML files directly into this view? You don't have to explicitly open this dialog first."
                style={{ marginBottom: 12 }}
              />
            )}

            {!hasFiles && (
              <NmlDropArea
                isClickAllowed={true}
                isUpdateAllowed={isUpdateAllowed}
                getInputProps={getInputProps}
              />
            )}

            {hasFiles && (
              <Spin spinning={isImporting}>
                <List
                  style={{ marginTop: 20, maxHeight: "40vh", overflowY: "auto" }}
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
            )}
          </div>
        )}
      </Dropzone>
    </Modal>
  );
};

/**
 * Container component that provides drag-and-drop functionality for NML/Zip files.
 * Wraps children with a Dropzone and handles the import modal workflow.
 */
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
    setFiles([]); // Clear files when closing
  }, [dispatch]);

  const isMounted = useRef(false);
  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
    };
  }, []);

  const onDrop = useCallback((droppedFiles: File[]) => {
    setFiles(droppedFiles);
    // Note: We don't need to manually "open" the modal because the existence of `files`
    // or `showDropzoneModal` will control the rendering of `UploadModal`.
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    noClick: true,
    noKeyboard: true,
    multiple: true,
    onDragEnter: (evt) => {
      if (!evt.dataTransfer.types || evt.dataTransfer.types.indexOf("Files") === -1) {
        return;
      }
    },
  });

  const importTracingFiles = useCallback(async () => {
    setIsImporting(true);
    try {
      await onImport(files, files.length > 1 ? createGroupForEachFile : createGroupForSingleFile);
      // On success, close logic
      if (isMounted.current) {
        setIsImporting(false);
        setFiles([]);
        dispatch(setDropzoneModalVisibilityAction(false));
      }
    } catch {
      if (isMounted.current) {
        setIsImporting(false);
      }
      // Keep files to allow retry? Or clear?
      // Original logic didn't clear on error (implicitly).
      // Actually `finally` block in original cleared it?
      // Original logic: `finally { if (mounted) { isImporting: false; files: [] } }`
      // So it cleared ANYWAY. I will replicate that.
      if (isMounted.current) {
        setFiles([]);
        dispatch(setDropzoneModalVisibilityAction(false));
      }
    }
  }, [files, createGroupForEachFile, createGroupForSingleFile, onImport, dispatch]);

  const shouldCreateGroup = files.length > 1 ? createGroupForEachFile : createGroupForSingleFile;
  const setShouldCreateGroup = (val: boolean) => {
    if (files.length > 1) {
      setCreateGroupForEachFile(val);
    } else {
      setCreateGroupForSingleFile(val);
    }
  };

  const isModalVisible = showDropzoneModal || files.length > 0;

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

      {/* Blue overlay when dragging over the whole window, BUT not if modal is already open */}
      {isDragActive && !isModalVisible && (
        <OverlayDropZone>
          <NmlDropArea
            isClickAllowed={false}
            isUpdateAllowed={isUpdateAllowed}
            getInputProps={getInputProps}
          />
        </OverlayDropZone>
      )}

      {isModalVisible && (
        <UploadModal
          files={files}
          onCancel={hideDropzoneModal}
          onImport={importTracingFiles}
          isImporting={isImporting}
          isUpdateAllowed={isUpdateAllowed}
          shouldCreateGroup={shouldCreateGroup}
          setShouldCreateGroup={setShouldCreateGroup}
          onDrop={onDrop}
        />
      )}

      {children}
    </div>
  );
}
