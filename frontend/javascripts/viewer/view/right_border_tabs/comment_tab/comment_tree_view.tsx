import { Tree as AntdTree, Empty, Flex, type GetRef, type TreeProps } from "antd";
import { useWkSelector } from "libs/react_hooks";
import { type Key, useCallback, useEffect, useRef } from "react";
import { useDispatch } from "react-redux";
import AutoSizer from "react-virtualized-auto-sizer";
import { getSkeletonTracing } from "viewer/model/accessors/skeletontracing_accessor";
import { setActiveNodeAction } from "viewer/model/actions/skeletontracing_actions";
import type { Tree } from "viewer/model/types/tree_types";
import { ColoredDotIcon } from "../segments_tab/segment_list_item";
import { TreeSwitcherIcon } from "../trees_tab/tree_switcher_icon";
import Comment, { commentListId } from "./comment";
import type { CommentTabNode, TreeRowNode } from "./comment_tab_types";
import { useActiveRowKey } from "./hooks/use_active_comment";

function TreeHeader({ tree }: { tree: Tree }) {
  return (
    <div style={{ wordBreak: "break-all" }}>
      <ColoredDotIcon colorRGBA={[...tree.color, 1.0]} /> {tree.name}
    </div>
  );
}

type CommentTreeViewProps = {
  treeNodes: TreeRowNode[];
  expandedKeys: Key[];
  onExpand: (expandedKeys: Key[]) => void;
};

export function CommentTreeView({ treeNodes, expandedKeys, onExpand }: CommentTreeViewProps) {
  const dispatch = useDispatch();
  const treeRef = useRef<GetRef<typeof AntdTree>>(null);
  const activeNodeId = useWkSelector(
    (state) => getSkeletonTracing(state.annotation)?.activeNodeId ?? null,
  );
  const activeRowKey = useActiveRowKey();

  useEffect(() => {
    if (activeRowKey == null) {
      return;
    }
    // The timeout is a work-around for rc-tree's virtual list: freshly added
    // nodes are not scrollable in the same render cycle in which they appear.
    const timeoutId = setTimeout(() =>
      treeRef.current?.scrollTo({ key: activeRowKey, align: "top" }),
    );
    return () => clearTimeout(timeoutId);
  }, [activeRowKey]);

  const handleSelect: TreeProps<CommentTabNode>["onSelect"] = useCallback(
    (_selectedKeys: Key[], info: { node: CommentTabNode }) => {
      // Tree rows are only expandable/collapsible; comment rows activate their node.
      if (info.node.type === "comment") {
        dispatch(setActiveNodeAction(info.node.comment.nodeId));
      }
    },
    [dispatch],
  );

  const handleExpand: TreeProps<CommentTabNode>["onExpand"] = useCallback(
    (newExpandedKeys: Key[]) => onExpand(newExpandedKeys),
    [onExpand],
  );

  const renderRow = useCallback(
    (node: CommentTabNode) =>
      node.type === "tree" ? (
        <TreeHeader tree={node.tree} />
      ) : (
        <Comment comment={node.comment} isActive={node.comment.nodeId === activeNodeId} />
      ),
    [activeNodeId],
  );

  if (treeNodes.length === 0) {
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
        <div id={commentListId} style={{ height, width, position: "relative" }}>
          <AntdTree<CommentTabNode>
            ref={treeRef}
            treeData={treeNodes}
            titleRender={renderRow}
            expandedKeys={expandedKeys}
            selectedKeys={activeRowKey != null ? [activeRowKey] : []}
            onExpand={handleExpand}
            onSelect={handleSelect}
            switcherIcon={({ expanded }: { expanded?: boolean }) => (
              <TreeSwitcherIcon expanded={expanded} />
            )}
            height={height}
            blockNode
            showLine
          />
        </div>
      )}
    </AutoSizer>
  );
}
