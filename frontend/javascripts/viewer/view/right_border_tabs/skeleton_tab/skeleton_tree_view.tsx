import type { Tree as AntdTree, GetRef, TreeProps } from "antd";
import { useEffectOnlyOnce, useWkSelector } from "libs/react_hooks";
import { useCallback, useEffect, useRef } from "react";
import { useDispatch } from "react-redux";
import AutoSizer from "react-virtualized-auto-sizer";
import { mayEditAnnotation } from "viewer/model/accessors/annotation_accessor";
import { enforceSkeletonTracing } from "viewer/model/accessors/skeletontracing_accessor";
import {
  expandParentGroupsOfTreeAction,
  setExpandedTreeGroupsByIdsAction,
  toggleAllTreesAction,
  toggleTreeAction,
  toggleTreeGroupAction,
} from "viewer/model/actions/skeletontracing_actions";
import { useReduxActionListener } from "viewer/model/helpers/listener_helpers";
import {
  getGroupByIdWithSubgroups,
  MISSING_GROUP_ID,
} from "viewer/view/right_border_tabs/shared/tree_hierarchy_view_helpers";
import { ResizableSplitPane } from "../resizable_split_pane";
import ScrollableVirtualizedTree from "../scrollable_virtualized_tree";
import { TreeSwitcherIcon } from "../shared/tree_switcher_icon";
import { useTreeContextMenu } from "../shared/use_tree_context_menu";
import { ContextMenuContainer } from "../sidebar_context_menu";
import { useGroupContextMenuBuilder, useTreeContextMenuBuilder } from "./context_menus";
import {
  type GroupUiNode,
  getGroupUiNodeKey,
  getTreeUiNodeKey,
  isRootGroupNode,
  type SkeletonHierarchy,
  type SkeletonUiNode,
  type TreeUiNode,
} from "./hierarchy";
import type { GroupOperations } from "./hooks/use_group_operations";
import type { TreeSelection } from "./hooks/use_tree_selection";
import { GroupNodeTitle, TreeNodeTitle } from "./node_titles";
import { SelectionDetails } from "./selection_details";

const CONTEXT_MENU_CLASS = "tree-list-context-menu-overlay";

type Props = {
  hierarchy: SkeletonHierarchy;
  selection: TreeSelection;
  groupOperations: GroupOperations;
};

export function SkeletonTreeView({ hierarchy, selection, groupOperations }: Props) {
  const dispatch = useDispatch();
  const allowUpdate = useWkSelector(mayEditAnnotation);
  const trees = useWkSelector((state) => enforceSkeletonTracing(state.annotation).trees);
  const activeTreeId = useWkSelector(
    (state) => enforceSkeletonTracing(state.annotation).activeTreeId,
  );
  const activeGroupId = useWkSelector(
    (state) => enforceSkeletonTracing(state.annotation).activeGroupId,
  );

  const treeRef = useRef<GetRef<typeof AntdTree>>(null);
  const {
    contextMenuPosition,
    contextMenu,
    openContextMenu,
    hideContextMenu,
    onRenameStart,
    onRenameEnd,
    getIsRenaming,
  } = useTreeContextMenu(CONTEXT_MENU_CLASS);

  const buildTreeContextMenu = useTreeContextMenuBuilder(selection, hideContextMenu);
  const buildGroupContextMenu = useGroupContextMenuBuilder(
    selection,
    groupOperations,
    hideContextMenu,
  );

  const onTreeNodeContextMenu = useCallback(
    (node: TreeUiNode, event: React.MouseEvent<HTMLElement>) =>
      openContextMenu(buildTreeContextMenu(node), event),
    [openContextMenu, buildTreeContextMenu],
  );

  const onGroupNodeContextMenu = useCallback(
    (node: GroupUiNode, event: React.MouseEvent<HTMLElement>) =>
      openContextMenu(buildGroupContextMenu(node), event),
    [openContextMenu, buildGroupContextMenu],
  );

  const scrollToActiveTree = useCallback(() => {
    if (activeTreeId != null && treeRef.current) {
      treeRef.current.scrollTo({ key: getTreeUiNodeKey(activeTreeId), align: "auto" });
    }
  }, [activeTreeId]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: Only react to active tree changes; the other dependencies change too often.
  useEffect(() => {
    // Scroll to the active tree whenever it changes (it can be changed by
    // actions outside of this component, too). The selection itself follows
    // the active tree inside useTreeSelection.
    if (activeTreeId != null) {
      // The target element might not be rendered yet, which would mess with
      // calculating the offsets for scrolling. Hence, delay this a bit.
      setTimeout(scrollToActiveTree, 50);
      // Ensure the active tree is not hidden inside collapsed parent groups.
      const activeTree = trees.getNullable(activeTreeId);
      if (activeTree?.groupId != null) {
        dispatch(expandParentGroupsOfTreeAction(activeTree));
      }
    }
  }, [activeTreeId]);

  useEffect(() => {
    // Scroll to the active group if it changes.
    if (treeRef.current && activeGroupId != null) {
      treeRef.current.scrollTo({ key: getGroupUiNodeKey(activeGroupId), align: "auto" });
    }
  }, [activeGroupId]);

  // Scroll to the active tree once after mounting. A longer delay is needed here
  // to ensure the tree list has actually been rendered.
  useEffectOnlyOnce(() => {
    setTimeout(scrollToActiveTree, 900);
  });

  // Allow scrolling to the active tree even if it did not change.
  useReduxActionListener("FOCUS_TREE", scrollToActiveTree);

  const onExpand: TreeProps<SkeletonUiNode>["onExpand"] = (expandedKeys, info) => {
    const expandedKeySet = new Set(expandedKeys as string[]);

    if (info.node.type === "group" && !info.expanded) {
      // When collapsing a group, also collapse all its subgroups.
      const collapsedGroup = info.node.group;
      for (const groupId of getGroupByIdWithSubgroups([collapsedGroup], collapsedGroup.groupId)) {
        expandedKeySet.delete(getGroupUiNodeKey(groupId));
      }
    }

    const expandedGroupIds = new Set<number>();
    for (const key of expandedKeySet) {
      const node = hierarchy.nodesByKey.get(key);
      if (node?.type === "group" && node.group.groupId !== MISSING_GROUP_ID) {
        expandedGroupIds.add(node.group.groupId);
      }
    }
    dispatch(setExpandedTreeGroupsByIdsAction(expandedGroupIds));
  };

  const onCheck: TreeProps<SkeletonUiNode>["onCheck"] = (_checkedKeys, info) => {
    const { node } = info;
    if (node.type === "tree") {
      dispatch(toggleTreeAction(node.tree.treeId));
    } else if (node.group.groupId === MISSING_GROUP_ID) {
      dispatch(toggleAllTreesAction());
    } else {
      dispatch(toggleTreeGroupAction(node.group.groupId));
    }
  };

  const onSelectTreeNode = (node: TreeUiNode, event: MouseEvent) => {
    const selectedTreeId = node.tree.treeId;

    if (event.ctrlKey || event.metaKey) {
      selection.multiSelectTree(selectedTreeId);
    } else if (event.shiftKey && activeTreeId != null) {
      // SHIFT click selects a whole range of trees. This only works for
      // trees within the same group/hierarchy level.
      const sourceTree = trees.getOrThrow(activeTreeId);
      const parentGroupNode = hierarchy.groupNodesById.get(sourceTree.groupId ?? MISSING_GROUP_ID);
      if (parentGroupNode == null) {
        return;
      }

      const siblings = parentGroupNode.children;
      const sourceIndex = siblings.findIndex(
        (sibling) => sibling.type === "tree" && sibling.tree.treeId === sourceTree.treeId,
      );
      const targetIndex = siblings.findIndex(
        (sibling) => sibling.type === "tree" && sibling.tree.treeId === selectedTreeId,
      );
      if (sourceIndex < 0 || targetIndex < 0) {
        return;
      }

      const [start, end] =
        sourceIndex < targetIndex ? [sourceIndex, targetIndex] : [targetIndex, sourceIndex];
      const treeIdsInRange = siblings
        .slice(start, end + 1)
        .filter((sibling) => sibling.type === "tree")
        .map((sibling) => sibling.tree.treeId);
      selection.selectTrees(treeIdsInRange);
    } else {
      // Regular click on a single tree without any multi-selection stuff.
      selection.selectSingleTree(selectedTreeId);
    }
  };

  const onSelect: TreeProps<SkeletonUiNode>["onSelect"] = (_selectedKeys, info) => {
    if (info.node.type === "tree") {
      onSelectTreeNode(info.node, info.nativeEvent as MouseEvent);
    } else {
      selection.selectGroup(info.node.group.groupId);
    }
  };

  const onDrop: TreeProps<SkeletonUiNode>["onDrop"] = (info) => {
    const { dragNode: draggedNode, node: dropTargetNode } = info;
    const targetGroupId =
      dropTargetNode.type === "group"
        ? dropTargetNode.group.groupId
        : (dropTargetNode.tree.groupId ?? MISSING_GROUP_ID);

    if (draggedNode.type === "tree") {
      // Dragged nodes are not considered clicked aka "properly selected".
      // In the multi-select case, all selected trees are moved along.
      const treeIdsToMove =
        selection.selectedTreeIds.length > 1
          ? [...selection.selectedTreeIds, draggedNode.tree.treeId]
          : [draggedNode.tree.treeId];
      groupOperations.moveTreesToGroup(treeIdsToMove, targetGroupId);
    } else {
      groupOperations.moveGroupToGroup(draggedNode.group.groupId, targetGroupId);
    }
  };

  const isNodeDraggable = (node: SkeletonUiNode): boolean =>
    allowUpdate && !getIsRenaming() && !isRootGroupNode(node);

  // selectedKeys is mainly used for highlighting, i.e. blueish background color.
  const selectedKeys =
    activeGroupId != null
      ? [getGroupUiNodeKey(activeGroupId)]
      : selection.selectedTreeIds.map(getTreeUiNodeKey);

  return (
    <>
      <ContextMenuContainer
        hideContextMenu={hideContextMenu}
        contextMenuPosition={contextMenuPosition}
        menu={contextMenu}
        className={CONTEXT_MENU_CLASS}
      />
      <ResizableSplitPane
        firstChild={
          <AutoSizer>
            {({ height, width }) => (
              <div style={{ height, width }}>
                <ScrollableVirtualizedTree<SkeletonUiNode>
                  treeData={hierarchy.roots}
                  height={height}
                  ref={treeRef}
                  titleRender={(node) =>
                    node.type === "tree" ? (
                      <TreeNodeTitle
                        node={node}
                        onContextMenu={onTreeNodeContextMenu}
                        onRenameStart={onRenameStart}
                        onRenameEnd={onRenameEnd}
                      />
                    ) : (
                      <GroupNodeTitle
                        node={node}
                        onContextMenu={onGroupNodeContextMenu}
                        onRenameStart={onRenameStart}
                        onRenameEnd={onRenameEnd}
                      />
                    )
                  }
                  switcherIcon={({ expanded }) => <TreeSwitcherIcon expanded={expanded} />}
                  onSelect={onSelect}
                  onDrop={onDrop}
                  onCheck={onCheck}
                  onExpand={onExpand}
                  // @ts-expect-error nodeDraggable is typed with the base type DataNode, but the tree data uses its extension SkeletonUiNode
                  draggable={{ nodeDraggable: isNodeDraggable, icon: false }}
                  checkedKeys={hierarchy.checkedKeys}
                  expandedKeys={hierarchy.expandedKeys}
                  selectedKeys={selectedKeys}
                  style={{ marginLeft: -24 }} // hide switcherIcon for root group
                  autoExpandParent
                  checkable
                  blockNode
                  showLine
                  multiple
                  defaultExpandAll
                />
              </div>
            )}
          </AutoSizer>
        }
        secondChild={<SelectionDetails selectedTreeIds={selection.selectedTreeIds} />}
      />
    </>
  );
}
