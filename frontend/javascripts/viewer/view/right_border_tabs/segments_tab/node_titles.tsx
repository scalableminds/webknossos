import { FolderOutlined } from "@ant-design/icons";
import { Flex, Typography } from "antd";
import { useWkSelector } from "libs/react_hooks";
import { memo } from "react";
import { getVisibleSegmentationLayer } from "viewer/model/accessors/dataset_accessor";
import { api } from "viewer/singletons";
import { MISSING_GROUP_ID } from "../shared/tree_hierarchy_view_helpers";
import type { SegmentGroupUiNode } from "./hierarchy";
import { InlineEditableName } from "./inline_editable_name";
import { SEGMENT_ROW_HEIGHT } from "./segment_row";
import { mayEditVisibleSegmentation } from "./segments_view_helper";

type Props = {
  node: SegmentGroupUiNode;
  isRenaming: boolean;
  onContextMenu: (node: SegmentGroupUiNode, event: React.MouseEvent<HTMLElement>) => void;
  onStartRenaming: (nodeKey: string) => void;
  onFinishRenaming: () => void;
};

/*
 * A group of the segment list: folder icon, name and the number of segments it contains
 * (including those of its subgroups). It shares the row height of a segment row, so that
 * the list keeps one rhythm from top to bottom.
 */
export const GroupNodeTitle = memo(
  ({ node, isRenaming, onContextMenu, onStartRenaming, onFinishRenaming }: Props) => {
    const { group } = node;
    const allowUpdate = useWkSelector(mayEditVisibleSegmentation);
    const visibleSegmentationLayer = useWkSelector(getVisibleSegmentationLayer);

    // Make sure the displayed name is not empty.
    const displayableName = group.name?.trim() || "<Unnamed Group>";

    return (
      <Flex
        align="center"
        gap={8}
        style={{ flex: "auto", minWidth: 0, height: SEGMENT_ROW_HEIGHT, cursor: "pointer" }}
        onContextMenu={(event) => onContextMenu(node, event)}
      >
        <FolderOutlined style={{ flex: "none" }} />
        <InlineEditableName
          displayedName={displayableName}
          editableValue={group.name ?? ""}
          placeholder="<Unnamed Group>"
          title={displayableName}
          isEditing={isRenaming}
          ellipsis
          strong
          style={{ flex: 1, minWidth: 0 }}
          // The root group must not be renamed.
          disableEditing={!allowUpdate || group.groupId === MISSING_GROUP_ID}
          onStartEditing={() => onStartRenaming(node.key)}
          onCommit={(name) => {
            if (visibleSegmentationLayer != null) {
              api.tracing.renameSegmentGroup(group.groupId, name, visibleSegmentationLayer.name);
            }
          }}
          onFinishEditing={onFinishRenaming}
        />
        <Typography.Text
          type="secondary"
          style={{ flex: "none", fontSize: 11, fontVariantNumeric: "tabular-nums" }}
        >
          {node.segmentCount}
        </Typography.Text>
      </Flex>
    );
  },
);
