import Icon, { FolderOutlined, TagsOutlined } from "@ant-design/icons";
import ProofreadingIcon from "@images/icons/icon-proofreading.svg?react";
import { Flex } from "antd";
import classnames from "classnames";
import FastTooltip from "components/fast_tooltip";
import { useWkSelector } from "libs/react_hooks";
import { memo } from "react";
import { useDispatch } from "react-redux";
import { TreeTypeEnum } from "viewer/constants";
import {
  isConcurrentCollaborationMode,
  mayEditAnnotation,
} from "viewer/model/accessors/annotation_accessor";
import { setTreeNameAction } from "viewer/model/actions/skeletontracing_actions";
import { api } from "viewer/singletons";
import { InlineEditableName } from "../shared/inline_editable_name";
import {
  ColorDot,
  centerOnFirstLine,
  EXPANDED_LINE_HEIGHT,
  EXPANDED_ROW_PADDING,
  LIST_ROW_GAP,
  LIST_ROW_HEIGHT,
  MoreActionsButton,
  RowTrailingSlot,
} from "../shared/list_row";
import { MISSING_GROUP_ID } from "../shared/tree_hierarchy_view_helpers";
import type { GroupUiNode, SkeletonUiNode, TreeUiNode } from "./hierarchy";

// The secondary icons that some trees carry (agglomerate, metadata). They keep their size
// while the name of an expanded row wraps, so they are centered on its first line.
const EXTRA_ICON_SIZE = 16;

type TitleProps<NodeType extends SkeletonUiNode> = {
  node: NodeType;
  isRenaming: boolean;
  onContextMenu: (node: NodeType, event: React.MouseEvent<HTMLElement>) => void;
  onStartRenaming: (nodeKey: string) => void;
  onFinishRenaming: () => void;
};

/*
 * One skeleton of the list. A single 30px row, laid out exactly like a segment row:
 *
 *   [checkbox] [color dot] [name .............] [extras] [node count] [hover actions]
 *
 * The checkbox and the indentation are rendered by antd around this title, which is why
 * the row-level treatments (hover/selected tint, the "active" accent bar, the alignment
 * of the expanded row) are attached to .ant-tree-treenode in _right_menu.less and keyed
 * off the modifier classes set here.
 */
export const TreeNodeTitle = memo(
  ({
    node,
    isRenaming,
    isActive,
    isSelected,
    isExpanded,
    onContextMenu,
    onStartRenaming,
    onFinishRenaming,
  }: TitleProps<TreeUiNode> & {
    // The active skeleton, marked with the left accent bar. It is usually selected, too,
    // but a multi-selection has no active skeleton of its own.
    isActive: boolean;
    isSelected: boolean;
    // Only a lone selection expands its name over several lines, see SegmentNodeTitle.
    isExpanded: boolean;
  }) => {
    const dispatch = useDispatch();
    const allowUpdate = useWkSelector(mayEditAnnotation);
    const isConcurrentCollabMode = useWkSelector(isConcurrentCollaborationMode);
    const { tree } = node;
    const isAgglomerateTree = tree.type === TreeTypeEnum.AGGLOMERATE;
    // In concurrent collaboration mode, only agglomerate trees (proofreading) may be edited.
    const disableEditing = !allowUpdate || (isConcurrentCollabMode && !isAgglomerateTree);
    const nodeCount = tree.nodes.size();
    // The type claims metadata is always set, but e.g. proto-imported trees can lack it at runtime.
    const hasMetadata = (tree.metadata ?? []).length > 0;

    const extraIconStyle: React.CSSProperties = {
      flex: "none",
      marginTop: isExpanded ? centerOnFirstLine(EXTRA_ICON_SIZE) : undefined,
    };

    return (
      <Flex
        className={classnames("list-row", {
          "list-row--accented": isActive,
          "list-row--expanded": isExpanded,
        })}
        align={isExpanded ? "flex-start" : "center"}
        gap={LIST_ROW_GAP}
        style={{
          flex: "auto",
          minWidth: 0,
          cursor: "pointer",
          height: isExpanded ? undefined : LIST_ROW_HEIGHT,
          padding: isExpanded ? `${EXPANDED_ROW_PADDING}px 0` : undefined,
        }}
        onContextMenu={(event) => onContextMenu(node, event)}
      >
        <ColorDot colorRGBA={[...tree.color, 1.0]} isExpanded={isExpanded} />
        <InlineEditableName
          displayedName={tree.name}
          editableValue={tree.name}
          placeholder="<Unnamed Skeleton>"
          isEditing={isRenaming}
          disableEditing={disableEditing}
          ellipsis={!isExpanded}
          strong={isSelected || isActive}
          style={{
            // The only track of the row that may shrink.
            flex: 1,
            minWidth: 0,
            color: isActive ? "var(--ant-color-primary-active)" : undefined,
            ...(isExpanded
              ? {
                  whiteSpace: "normal",
                  lineHeight: `${EXPANDED_LINE_HEIGHT}px`,
                  textWrap: "pretty",
                }
              : null),
          }}
          // The truncated rows need the full name on hover; the expanded one shows it anyway.
          title={isExpanded ? undefined : tree.name}
          onStartEditing={() => onStartRenaming(node.key)}
          onCommit={(newName) => dispatch(setTreeNameAction(newName, tree.treeId))}
          onFinishEditing={onFinishRenaming}
        />
        {isAgglomerateTree ? (
          <FastTooltip title="Agglomerate Skeleton" style={extraIconStyle}>
            <Icon component={ProofreadingIcon} />
          </FastTooltip>
        ) : null}
        {hasMetadata ? (
          <FastTooltip
            className="deemphasized"
            title="This skeleton has assigned metadata properties."
            style={extraIconStyle}
          >
            <TagsOutlined />
          </FastTooltip>
        ) : null}
        <RowTrailingSlot
          count={nodeCount}
          countTitle={`${nodeCount} nodes`}
          isExpanded={isExpanded}
        >
          <MoreActionsButton onOpenContextMenu={(event) => onContextMenu(node, event)} />
        </RowTrailingSlot>
      </Flex>
    );
  },
);

/*
 * A group of the skeleton list: folder icon, name and the number of skeletons it contains
 * (including those of its subgroups). It shares the row height of a skeleton row, so that
 * the list keeps one rhythm from top to bottom.
 */
export const GroupNodeTitle = memo(
  ({
    node,
    isRenaming,
    onContextMenu,
    onStartRenaming,
    onFinishRenaming,
  }: TitleProps<GroupUiNode>) => {
    const allowUpdate = useWkSelector(mayEditAnnotation);
    const isConcurrentCollabMode = useWkSelector(isConcurrentCollaborationMode);
    const { group } = node;

    // Make sure the displayed name is not empty.
    const displayableName = group.name?.trim() || "<Unnamed Group>";

    return (
      <Flex
        className="list-row"
        align="center"
        gap={LIST_ROW_GAP}
        style={{ flex: "auto", minWidth: 0, height: LIST_ROW_HEIGHT, cursor: "pointer" }}
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
          disableEditing={
            !allowUpdate || isConcurrentCollabMode || group.groupId === MISSING_GROUP_ID
          }
          onStartEditing={() => onStartRenaming(node.key)}
          onCommit={(newName) => api.tracing.renameSkeletonGroup(group.groupId, newName)}
          onFinishEditing={onFinishRenaming}
        />
        {/* Groups carry the same trailing slot as the rows above and below them, so that
            the counts of the whole list line up in one column. */}
        <RowTrailingSlot count={node.treeCount} countTitle={`${node.treeCount} skeletons`}>
          <MoreActionsButton onOpenContextMenu={(event) => onContextMenu(node, event)} />
        </RowTrailingSlot>
      </Flex>
    );
  },
);
