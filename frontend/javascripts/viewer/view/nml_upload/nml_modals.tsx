import { Alert, Button, Checkbox, Modal, Spin, TreeSelect } from "antd";
import { Fragment } from "react";
import Dropzone from "react-dropzone";
import { useDispatch } from "react-redux";
import { setDropzoneModalVisibilityAction } from "viewer/model/actions/ui_actions";
import type { TreeGroup } from "viewer/model/types/tree_types";
import { MISSING_GROUP_ID } from "viewer/view/right_border_tabs/shared/tree_hierarchy_view_helpers";
import { NmlDropzoneContent, NmlList } from "./nml_upload_components";

type GroupTreeSelectNode = {
  title: string;
  value: number;
  children: GroupTreeSelectNode[];
};

function treeGroupsToTreeSelectData(treeGroups: TreeGroup[]): GroupTreeSelectNode[] {
  return treeGroups.map((group) => ({
    title: group.name,
    value: group.groupId,
    children: treeGroupsToTreeSelectData(group.children),
  }));
}

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
  showTreeGroupSelect,
  existingTreeGroups,
  targetGroupId,
  setTargetGroupId,
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
  showTreeGroupSelect: boolean;
  existingTreeGroups: TreeGroup[];
  targetGroupId: number;
  setTargetGroupId: (groupId: number) => void;
}) {
  const newGroupMsg =
    files.length > 1
      ? "Create a new tree group for each file."
      : "Create a new tree group for this file.";
  const pluralS = files.length > 1 ? "s" : "";
  const groupTreeSelectData: GroupTreeSelectNode[] = [
    {
      title: "Root",
      value: MISSING_GROUP_ID,
      children: treeGroupsToTreeSelectData(existingTreeGroups),
    },
  ];
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
        {showTreeGroupSelect ? (
          <div style={{ marginBottom: 12 }}>
            <span style={{ marginRight: 8 }}>Add imported trees to group:</span>
            <TreeSelect
              style={{ width: 300 }}
              value={targetGroupId}
              onChange={setTargetGroupId}
              treeData={groupTreeSelectData}
              treeDefaultExpandAll
              showSearch={{ treeNodeFilterProp: "title" }}
              popupMatchSelectWidth={false}
            />
          </div>
        ) : null}
        <NmlList files={files} />
      </Spin>
    </Modal>
  );
}
