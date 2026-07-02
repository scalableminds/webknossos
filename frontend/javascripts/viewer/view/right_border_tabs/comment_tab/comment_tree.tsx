import { Tree as AntdTree, Empty, Flex, type GetRef, type TreeProps } from "antd";
import type { EventDataNode } from "antd/es/tree";
import type React from "react";
import AutoSizer from "react-virtualized-auto-sizer";
import type { MutableCommentType, Tree } from "viewer/model/types/tree_types";
import Comment, { commentListId } from "viewer/view/right_border_tabs/comment_tab/comment";
import {
  getCommentSorter,
  type SortByEnum,
} from "viewer/view/right_border_tabs/comment_tab/comment_sorting";
import { ColoredDotIcon } from "../segments_tab/segment_list_item";
import { TreeSwitcherIcon } from "../trees_tab/tree_switcher_icon";

type Props = {
  trees: Tree[];
  sortBy: SortByEnum;
  isSortedAscending: boolean;
  activeNodeId: number | undefined | null;
  expandedKeys: React.Key[];
  selectedKeys: React.Key[];
  onExpand: (expandedKeys: React.Key[]) => void;
  onSelect: (selectedKeys: React.Key[], info: { node: EventDataNode<MutableCommentType> }) => void;
  treeRef: React.Ref<GetRef<typeof AntdTree>>;
};

export default function CommentTree({
  trees,
  sortBy,
  isSortedAscending,
  activeNodeId,
  expandedKeys,
  selectedKeys,
  onExpand,
  onSelect,
  treeRef,
}: Props) {
  const commentSorter = getCommentSorter(sortBy, isSortedAscending);

  const treeData: TreeProps["treeData"] = trees.map((tree) => ({
    key: tree.treeId.toString(),
    title: (
      <div style={{ wordBreak: "break-all" }}>
        <ColoredDotIcon colorRGBA={[...tree.color, 1.0]} /> {tree.name}
      </div>
    ),
    expanded: true,
    children: tree.comments
      .slice()
      .sort(commentSorter)
      .map((comment) => {
        const key = `comment-${comment.nodeId}`;
        const isActive = comment.nodeId === activeNodeId;
        return {
          ...comment,
          key: key,
          title: <Comment key={key} comment={comment} isActive={isActive} />,
        };
      }),
  }));

  if (treeData.length === 0) {
    return (
      <Flex justify="center">
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="There are no comments. Create a skeleton node and type in the above text field to add a comment."
        />
      </Flex>
    );
  }

  return (
    <AutoSizer defaultHeight={500}>
      {({ height, width }) => (
        <div
          style={{
            height,
            width,
          }}
        >
          <AntdTree
            key={commentListId}
            treeData={treeData}
            expandedKeys={expandedKeys}
            selectedKeys={selectedKeys}
            onExpand={onExpand}
            // @ts-expect-error
            onSelect={onSelect}
            switcherIcon={({ expanded }) => <TreeSwitcherIcon expanded={expanded} />}
            height={height}
            ref={treeRef}
            blockNode
            showLine
            defaultExpandAll
          />
        </div>
      )}
    </AutoSizer>
  );
}
