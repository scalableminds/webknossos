import { useIsMounted, useWkSelector } from "libs/react_hooks";
import type React from "react";
import { useCallback, useState } from "react";
import Dropzone from "react-dropzone";
import { useDispatch } from "react-redux";
import { setDropzoneModalVisibilityAction } from "viewer/model/actions/ui_actions";
import { DropzoneModal, ImportModal } from "./nml_modals";
import { NmlDropzoneContent } from "./nml_upload_components";

function OverlayDropZone({ children }: { children: React.ReactNode }) {
  return (
    <div className="nml-upload-zone-overlay">
      <div className="nml-upload-zone-modal">{children}</div>
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
  const showDropzoneModal = useWkSelector((state) => state.uiInformation.showDropzoneModal);
  const navbarHeight = useWkSelector((state) => state.uiInformation.navbarHeight);
  const dispatch = useDispatch();
  // dispatch(setDropzoneModalVisibilityAction(false));

  const [files, setFiles] = useState<File[]>([]);
  const [dropzoneActive, setDropzoneActive] = useState<boolean>(false);
  const [isImporting, setIsImporting] = useState<boolean>(false);
  const [createGroupForEachFile, setCreateGroupForEachFile] = useState<boolean>(true);
  const [createGroupForSingleFile, setCreateGroupForSingleFile] = useState<boolean>(false);

  const isMounted = useIsMounted();

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
    (files: File[]) => {
      setFiles(files);
      setDropzoneActive(false);
      dispatch(setDropzoneModalVisibilityAction(false));
    },
    [dispatch],
  );

  const importTracingFiles = useCallback(async () => {
    setIsImporting(true);
    try {
      await onImport(files, files.length > 1 ? createGroupForEachFile : createGroupForSingleFile);
    } finally {
      if (isMounted()) {
        setIsImporting(false);
        setFiles([]);
      }
    }
  }, [onImport, files, createGroupForEachFile, createGroupForSingleFile, isMounted]);

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
              <NmlDropzoneContent
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
          {showDropzoneModal ? (
            <DropzoneModal isUpdateAllowed={isUpdateAllowed} onDrop={onDrop} />
          ) : null}

          {
            // Once, files were dropped, we render the import modal
          }
          <ImportModal
            files={files}
            createGroupForEachFile={createGroupForEachFile}
            createGroupForSingleFile={createGroupForSingleFile}
            isUpdateAllowed={isUpdateAllowed}
            isImporting={isImporting}
            setFiles={setFiles}
            setCreateGroupForEachFile={setCreateGroupForEachFile}
            setCreateGroupForSingleFile={setCreateGroupForSingleFile}
            importTracingFiles={importTracingFiles}
          />

          {children}
        </div>
      )}
    </Dropzone>
  );
}
