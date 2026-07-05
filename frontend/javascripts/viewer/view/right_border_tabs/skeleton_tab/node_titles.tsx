import Icon, { FolderOutlined, TagsOutlined } from "@ant-design/icons";
import ProofreadingIcon from "@images/icons/icon-proofreading.svg?react";
import { Space } from "antd";
import FastTooltip from "components/fast_tooltip";
import type React from "react";
import { useDispatch } from "react-redux";
import { TreeTypeEnum } from "viewer/constants";
import { setTreeNameAction } from "viewer/model/actions/skeletontracing_actions";
import { api } from "viewer/singletons";
import EditableTextLabel from "viewer/view/components/editable_text_label";
import { ColoredDotIcon } from "../segments_tab/segment_list_item";
import type { GroupUiNode, SkeletonUiNode, TreeUiNode } from "./hierarchy";

type TitleProps<NodeType extends SkeletonUiNode> = {
  node: NodeType;
  onContextMenu: (node: NodeType, event: React.MouseEvent<HTMLDivElement>) => void;
  onRenameStart: () => void;
  onRenameEnd: () => void;
};

export function TreeNodeTitle({
  node,
  onContextMenu,
  onRenameStart,
  onRenameEnd,
}: TitleProps<TreeUiNode>) {
  const dispatch = useDispatch();
  const { tree } = node;

  const maybeProofreadingIcon =
    tree.type === TreeTypeEnum.AGGLOMERATE ? (
      <FastTooltip title="Agglomerate Tree">
        <Icon component={ProofreadingIcon} />
      </FastTooltip>
    ) : null;

  return (
    <Space
      size={4}
      align="center"
      onContextMenu={(event) => onContextMenu(node, event)}
      style={{ wordBreak: "break-word", width: "100%" }}
    >
      <ColoredDotIcon colorRGBA={[...tree.color, 1.0]} />
      <span style={{ whiteSpace: "nowrap" }}>
        {`(${tree.nodes.size()}) `} {maybeProofreadingIcon}
      </span>
      <EditableTextLabel
        value={tree.name}
        label="Tree Name"
        onRenameStart={onRenameStart}
        onRenameEnd={onRenameEnd}
        onChange={(newName) => dispatch(setTreeNameAction(newName, tree.treeId))}
        hideEditIcon
      />
      {/* The type claims metadata is always set, but e.g. proto-imported trees can lack it at runtime. */}
      {(tree.metadata ?? []).length > 0 ? (
        <FastTooltip className="deemphasized" title="This tree has assigned metadata properties.">
          <TagsOutlined />
        </FastTooltip>
      ) : null}
    </Space>
  );
}

export function GroupNodeTitle({
  node,
  onContextMenu,
  onRenameStart,
  onRenameEnd,
}: TitleProps<GroupUiNode>) {
  const { group } = node;
  // Make sure the displayed name is not empty
  const displayableName = group.name.trim() || "<Unnamed Group>";

  return (
    <Space
      size={4}
      onContextMenu={(event) => onContextMenu(node, event)}
      style={{ wordBreak: "break-word", width: "100%" }}
    >
      <FolderOutlined />
      <EditableTextLabel
        value={displayableName}
        label="Group Name"
        onChange={(newName) => api.tracing.renameSkeletonGroup(group.groupId, newName)}
        hideEditIcon
        onRenameStart={onRenameStart}
        onRenameEnd={onRenameEnd}
      />
    </Space>
  );
}
