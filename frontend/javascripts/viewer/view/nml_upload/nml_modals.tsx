import { Alert, Button, Checkbox, Modal, Spin } from "antd";
import { Fragment } from "react";
import Dropzone from "react-dropzone";
import { useDispatch } from "react-redux";
import { setDropzoneModalVisibilityAction } from "viewer/model/actions/ui_actions";
import { NmlDropzoneContent, NmlList } from "./nml_upload_components";

export function DropzoneModal({
  isUpdateAllowed,
  onDrop,
}: {
  isUpdateAllowed: boolean;
  onDrop: (files: File[]) => void;
}) {
  const dispatch = useDispatch();
  return (
    <Modal open footer={null} onCancel={() => dispatch(setDropzoneModalVisibilityAction(false))}>
      {isUpdateAllowed ? (
        <Alert
          title="Did you know that you can just drag-and-drop NML files directly into this view? You don't have to explicitly open this dialog first."
          style={{
            marginBottom: 12,
          }}
        />
      ) : null}
      <Dropzone multiple onDrop={onDrop}>
        {({ getRootProps, getInputProps }) => (
          <div {...getRootProps()}>
            <NmlDropzoneContent
              isClickAllowed
              isUpdateAllowed={isUpdateAllowed}
              getInputProps={getInputProps}
            />
          </div>
        )}
      </Dropzone>
    </Modal>
  );
}

export function ImportModal({
  files,
  createGroupForEachFile,
  createGroupForSingleFile,
  isUpdateAllowed,
  isImporting,
  setFiles,
  setCreateGroupForEachFile,
  setCreateGroupForSingleFile,
  importTracingFiles,
}: {
  files: File[];
  createGroupForEachFile: boolean;
  createGroupForSingleFile: boolean;
  isUpdateAllowed: boolean;
  isImporting: boolean;
  setFiles: (files: File[]) => void;
  setCreateGroupForEachFile: (a: boolean) => void;
  setCreateGroupForSingleFile: (a: boolean) => void;
  importTracingFiles: () => Promise<void>;
}) {
  const newGroupMsg =
    files.length > 1
      ? "Create a new tree group for each file."
      : "Create a new tree group for this file.";
  const pluralS = files.length > 1 ? "s" : "";
  return (
    <Modal
      title={`Import ${files.length} Annotation${pluralS}`}
      open={files.length > 0}
      onCancel={() => setFiles([])}
      footer={
        <Fragment>
          <Checkbox
            style={{
              float: "left",
            }}
            onChange={(e) =>
              files.length > 1
                ? setCreateGroupForEachFile(e.target.checked)
                : setCreateGroupForSingleFile(e.target.checked)
            }
            checked={files.length > 1 ? createGroupForEachFile : createGroupForSingleFile}
          >
            {newGroupMsg}
          </Checkbox>
          <Button key="submit" type="primary" onClick={importTracingFiles}>
            {isUpdateAllowed ? "Import" : "Create New Annotation"}
          </Button>
        </Fragment>
      }
    >
      <Spin spinning={isImporting}>
        <NmlList files={files} />
      </Spin>
    </Modal>
  );
}
