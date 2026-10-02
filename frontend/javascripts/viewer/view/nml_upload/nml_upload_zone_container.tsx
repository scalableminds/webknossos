import { useIsMounted, useWkSelector } from "libs/react_hooks";
import { stripFileExtension } from "libs/utils";
import type React from "react";
import { useCallback, useState } from "react";
import Dropzone from "react-dropzone";
import { useDispatch } from "react-redux";
import { getSkeletonTracing } from "viewer/model/accessors/skeletontracing_accessor";
import { setDropzoneModalVisibilityAction } from "viewer/model/actions/ui_actions";
import type { TreeGroup } from "viewer/model/types/tree_types";
import { MISSING_GROUP_ID } from "viewer/view/right_border_tabs/shared/tree_hierarchy_view_helpers";
import { DropzoneModal, ImportModal } from "./nml_modals";
import { NmlDropzoneContent } from "./nml_upload_components";

// Kept as a stable reference so that the useWkSelector below doesn't trigger a
// re-render on every store update when there is no skeleton tracing to read from.
const EMPTY_TREE_GROUPS: TreeGroup[] = [];

/** The destination the user picked in the import modal. */
export type NmlImportOptions = {
  createGroupForEachFile: boolean; // Whether to wrap each file's trees in a new group.
  targetGroupId: number;
  newGroupName?: string; // If createGroupForEachFile is set -> the name of the wrapping group.
};

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
  onImport: (files: File[], options: NmlImportOptions) => Promise<void>;
}) {
  const showDropzoneModal = useWkSelector((state) => state.uiInformation.showDropzoneModal);
  const navbarHeight = useWkSelector((state) => state.uiInformation.navbarHeight);
  const isInAnnotationView = useWkSelector((state) => state.uiInformation.isInAnnotationView);
  const existingTreeGroups = useWkSelector(
    (state) => getSkeletonTracing(state.annotation)?.treeGroups ?? EMPTY_TREE_GROUPS,
  );
  const dispatch = useDispatch();
  // dispatch(setDropzoneModalVisibilityAction(false));

  const [files, setFiles] = useState<File[]>([]);
  const [dropzoneActive, setDropzoneActive] = useState<boolean>(false);
  const [isImporting, setIsImporting] = useState<boolean>(false);
  const [createGroupForEachFile, setCreateGroupForEachFile] = useState<boolean>(false);
  const [targetGroupId, setTargetGroupId] = useState<number>(MISSING_GROUP_ID);
  const [newGroupName, setNewGroupName] = useState<string>("");

  // Only show a picker for an existing tree group when there is actually a tracing to
  // look up tree groups from (i.e. not in the dashboard) and the drop will update it
  // (as opposed to creating a brand new annotation).
  const showTreeGroupSelect = isInAnnotationView && isUpdateAllowed;

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
      // Reset the target group selection for every new drop so that it defaults to the root group.
      setTargetGroupId(MISSING_GROUP_ID);
      // Wrapping each file into a group of its own is the sensible default for a multi-file
      // drop, because it keeps the files apart. A single file is usually meant to be merged
      // into the target group as-is.
      setCreateGroupForEachFile(files.length > 1);
      // Propose the file name as the name of a potential new group. Only relevant for
      // single-file drops, because a new group per file is always named after its file.
      setNewGroupName(files.length === 1 ? stripFileExtension(files[0].name) : "");
      dispatch(setDropzoneModalVisibilityAction(false));
    },
    [dispatch],
  );

  const importTracingFiles = useCallback(async () => {
    setIsImporting(true);
    try {
      await onImport(files, {
        createGroupForEachFile,
        targetGroupId,
        newGroupName: files.length === 1 ? newGroupName.trim() : undefined,
      });
    } finally {
      if (isMounted()) {
        setIsImporting(false);
        setFiles([]);
      }
    }
  }, [onImport, files, createGroupForEachFile, targetGroupId, newGroupName, isMounted]);

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
            isUpdateAllowed={isUpdateAllowed}
            isImporting={isImporting}
            setFiles={setFiles}
            setCreateGroupForEachFile={setCreateGroupForEachFile}
            importTracingFiles={importTracingFiles}
            showTreeGroupSelect={showTreeGroupSelect}
            existingTreeGroups={existingTreeGroups}
            targetGroupId={targetGroupId}
            setTargetGroupId={setTargetGroupId}
            newGroupName={newGroupName}
            setNewGroupName={setNewGroupName}
          />

          {children}
        </div>
      )}
    </Dropzone>
  );
}
