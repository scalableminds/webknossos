import { DeleteOutlined, FolderOutlined, PlusOutlined } from "@ant-design/icons";
import { Divider, type MenuProps, Space } from "antd";
import type { ItemType } from "antd/lib/menu/interface";
import React from "react";
import type { APISegmentationLayer } from "types/api_types";
import { api } from "viewer/singletons";
import EditableTextLabel from "viewer/view/components/editable_text_label";
import { getContextMenuPositionFromEvent } from "viewer/view/context_menu/helpers";
import { MISSING_GROUP_ID } from "../trees_tab/tree_hierarchy_view_helpers";

type SegmentGroupItemProps = {
  groupId: number;
  name: string | null | undefined;
  allowUpdate: boolean;
  visibleSegmentationLayer: APISegmentationLayer | null | undefined;
  onRenameStart: () => void;
  onRenameEnd: () => void;
  showContextMenuAt: (xPos: number, yPos: number, menu: MenuProps) => void;
  hideContextMenu: () => void;
  createGroup: (groupId: number) => void;
  handleDeleteGroup: (groupId: number) => void;
  getExpandSubgroupsItem: (groupId: number) => ItemType | null;
  getCollapseSubgroupsItem: (groupId: number) => ItemType | null;
  getMoveSegmentsHereMenuItem: (groupId: number) => ItemType | null;
  getSetGroupColorMenuItem: (groupId: number) => ItemType | null;
  getResetGroupColorMenuItem: (groupId: number) => ItemType | null;
  getShowSegmentStatistics: (groupId: number) => ItemType | null;
  getLoadMeshesFromFileMenuItem: (groupId: number) => ItemType | null;
  getComputeMeshesAdHocMenuItem: (groupId: number) => ItemType | null;
  getReloadMenuItem: (groupId: number) => ItemType | null;
  getRemoveMeshesMenuItem: (groupId: number) => ItemType | null;
  maybeGetShowOrHideMeshesMenuItems: (groupId: number) => ItemType | ItemType[] | null;
  getDownLoadMeshesMenuItem: (groupId: number) => ItemType | null;
  segmentStatisticsModal: React.ReactNode;
};

/**
 * Renders a single segment group node within the segment hierarchy tree.
 * Displays a folder icon, an editable group name, and provides a right-click
 * context menu with actions like creating subgroups, deleting, mesh operations, etc.
 */
function _SegmentGroupItem({
  groupId,
  name,
  allowUpdate,
  visibleSegmentationLayer,
  onRenameStart,
  onRenameEnd,
  showContextMenuAt,
  hideContextMenu,
  createGroup,
  handleDeleteGroup,
  getExpandSubgroupsItem,
  getCollapseSubgroupsItem,
  getMoveSegmentsHereMenuItem,
  getSetGroupColorMenuItem,
  getResetGroupColorMenuItem,
  getShowSegmentStatistics,
  getLoadMeshesFromFileMenuItem,
  getComputeMeshesAdHocMenuItem,
  getReloadMenuItem,
  getRemoveMeshesMenuItem,
  maybeGetShowOrHideMeshesMenuItems,
  getDownLoadMeshesMenuItem,
  segmentStatisticsModal,
}: SegmentGroupItemProps) {
  const isEditingDisabled = !allowUpdate;

  const onOpenContextMenu = (event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    const getMenu = (): MenuProps => ({
      items: [
        {
          key: "create",
          onClick: () => {
            createGroup(groupId);
            hideContextMenu();
          },
          disabled: isEditingDisabled,
          icon: <PlusOutlined />,
          label: "Create new group",
        },
        {
          key: "delete",
          disabled: isEditingDisabled,
          onClick: () => {
            handleDeleteGroup(groupId);
            hideContextMenu();
          },
          icon: <DeleteOutlined />,
          label: "Delete group",
        },
        getExpandSubgroupsItem(groupId),
        getCollapseSubgroupsItem(groupId),
        getMoveSegmentsHereMenuItem(groupId),
        {
          key: "groupAndMeshActionDivider",
          label: <Divider style={{ marginBottom: 0, marginTop: 0 }} />,
          disabled: true,
        },
        getSetGroupColorMenuItem(groupId),
        getResetGroupColorMenuItem(groupId),
        getShowSegmentStatistics(groupId),
        getLoadMeshesFromFileMenuItem(groupId),
        getComputeMeshesAdHocMenuItem(groupId),
        getReloadMenuItem(groupId),
        getRemoveMeshesMenuItem(groupId),
        maybeGetShowOrHideMeshesMenuItems(groupId),
        getDownLoadMeshesMenuItem(groupId),
      ].flat(),
    });

    const [x, y] = getContextMenuPositionFromEvent(event, "segment-list-context-menu-overlay");
    showContextMenuAt(x, y, getMenu());
  };

  // Make sure the displayed name is not empty
  const displayableName = name?.trim() || "<Unnamed Group>";

  return (
    <Space onContextMenu={onOpenContextMenu} size={4}>
      <FolderOutlined />
      <EditableTextLabel
        value={displayableName}
        label="Group Name"
        onChange={(newName) => {
          if (visibleSegmentationLayer != null) {
            api.tracing.renameSegmentGroup(groupId, newName, visibleSegmentationLayer.name);
          }
        }}
        // The root group must not be removed or renamed
        disableEditing={!allowUpdate || groupId === MISSING_GROUP_ID}
        onRenameStart={onRenameStart}
        onRenameEnd={onRenameEnd}
      />
      {segmentStatisticsModal}
    </Space>
  );
}

const SegmentGroupItem = React.memo(_SegmentGroupItem);
export default SegmentGroupItem;
