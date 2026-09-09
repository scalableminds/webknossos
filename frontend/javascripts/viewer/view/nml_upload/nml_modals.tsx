import { Alert, Flex, Input, Modal, Radio, TreeSelect, Typography } from "antd";
import { useEffect, useState } from "react";
import Dropzone from "react-dropzone";
import { useDispatch } from "react-redux";
import { setDropzoneModalVisibilityAction } from "viewer/model/actions/ui_actions";
import type { TreeGroup } from "viewer/model/types/tree_types";
import {
  findGroup,
  MISSING_GROUP_ID,
} from "viewer/view/right_border_tabs/shared/tree_hierarchy_view_helpers";
import { NmlDropzoneContent, NmlFileList } from "./nml_upload_components";

const ROOT_GROUP_NAME = "Root";

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

function collectGroupIds(treeGroups: TreeGroup[]): number[] {
  return treeGroups.flatMap((group) => [group.groupId, ...collectGroupIds(group.children)]);
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
  isUpdateAllowed,
  isImporting,
  setFiles,
  setCreateGroupForEachFile,
  importTracingFiles,
  showTreeGroupSelect,
  existingTreeGroups,
  targetGroupId,
  setTargetGroupId,
  newGroupName,
  setNewGroupName,
}: {
  files: File[];
  createGroupForEachFile: boolean;
  isUpdateAllowed: boolean;
  isImporting: boolean;
  setFiles: (files: File[]) => void;
  setCreateGroupForEachFile: (a: boolean) => void;
  importTracingFiles: () => Promise<void>;
  showTreeGroupSelect: boolean;
  existingTreeGroups: TreeGroup[];
  targetGroupId: number;
  setTargetGroupId: (groupId: number) => void;
  newGroupName: string;
  setNewGroupName: (name: string) => void;
}) {
  const hasMultipleFiles = files.length > 1;
  const pluralS = hasMultipleFiles ? "s" : "";
  // The name of a new group is only user-editable when exactly one group is created and the
  // import happens client-side. For a multi-file drop there would be one name per file, and
  // when a brand new annotation is created the names are derived by the back-end.
  const isNewGroupNameEditable = showTreeGroupSelect && !hasMultipleFiles;
  const isNewGroupNameValid = newGroupName.trim().length > 0;

  const parentGroupName =
    targetGroupId === MISSING_GROUP_ID
      ? ROOT_GROUP_NAME
      : (findGroup(existingTreeGroups, targetGroupId)?.name ?? ROOT_GROUP_NAME);

  const groupTreeSelectData: GroupTreeSelectNode[] = [
    {
      title: ROOT_GROUP_NAME,
      value: MISSING_GROUP_ID,
      children: treeGroupsToTreeSelectData(existingTreeGroups),
    },
  ];

  // Show the whole group hierarchy expanded so that the wanted group is easy to spot.
  // The expanded keys are controlled instead of using treeDefaultExpandAll, because the
  // latter is only evaluated when the tree mounts: this modal already exists while the
  // annotation is still loading, so groups that arrive afterwards would stay collapsed.
  const [expandedGroupIds, setExpandedGroupIds] = useState<number[]>([]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: files is a trigger, to expand all groups again if a new file is dropped.
  useEffect(() => {
    setExpandedGroupIds([MISSING_GROUP_ID, ...collectGroupIds(existingTreeGroups)]);
  }, [existingTreeGroups, files]);

  return (
    <Modal
      title={`Import ${files.length} Annotation${pluralS}`}
      open={files.length > 0}
      onCancel={() => setFiles([])}
      onOk={importTracingFiles}
      okText={isUpdateAllowed ? "Import" : "Create New Annotation"}
      confirmLoading={isImporting}
      okButtonProps={{
        disabled: createGroupForEachFile && isNewGroupNameEditable && !isNewGroupNameValid,
      }}
    >
      <Flex vertical gap="middle">
        <NmlFileList files={files} />

        <Flex vertical gap={10}>
          <Typography.Text strong type="secondary">
            Where should the imported trees go?
          </Typography.Text>

          {showTreeGroupSelect ? (
            <TreeSelect
              value={targetGroupId}
              onChange={setTargetGroupId}
              treeData={groupTreeSelectData}
              treeExpandedKeys={expandedGroupIds}
              onTreeExpand={(keys) => setExpandedGroupIds(keys as number[])}
              showSearch={{ treeNodeFilterProp: "title" }}
              popupMatchSelectWidth={false}
            />
          ) : null}

          <Radio.Group
            value={createGroupForEachFile}
            onChange={(event) => setCreateGroupForEachFile(event.target.value)}
          >
            <Flex vertical gap={4}>
              <Radio value={false}>
                {showTreeGroupSelect
                  ? "Add the trees directly to this group"
                  : "Add all trees at the top level"}
              </Radio>
              <Radio value={true}>
                {getNewGroupRadioLabel(hasMultipleFiles, showTreeGroupSelect)}
              </Radio>
            </Flex>
          </Radio.Group>

          {/* Indented so that the controls read as part of the radio option above them. */}
          {createGroupForEachFile ? (
            <Flex style={{ marginInlineStart: 24 }}>
              {isNewGroupNameEditable ? (
                <Input
                  value={newGroupName}
                  onChange={(event) => setNewGroupName(event.target.value)}
                  status={isNewGroupNameValid ? undefined : "error"}
                  prefix={<Typography.Text type="secondary">{parentGroupName} ›</Typography.Text>}
                  placeholder="Group name"
                />
              ) : (
                <Typography.Text type="secondary">
                  {hasMultipleFiles
                    ? "Each group is named after the file it holds."
                    : "The group is named after the file."}
                </Typography.Text>
              )}
            </Flex>
          ) : null}
        </Flex>
      </Flex>
    </Modal>
  );
}

function getNewGroupRadioLabel(hasMultipleFiles: boolean, showTreeGroupSelect: boolean) {
  if (showTreeGroupSelect) {
    return hasMultipleFiles ? "Create a new subgroup for each file" : "Create a new subgroup";
  }
  return hasMultipleFiles ? "Create a new group for each file" : "Create a new group";
}
