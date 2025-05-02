import { DownOutlined } from "@ant-design/icons";
import { type Tree as AntdTree, type GetRef, type MenuProps, Modal, type TreeProps } from "antd";
import { SimpleRow } from "dashboard/folders/metadata_table";
import * as Utils from "libs/utils";
import _ from "lodash";
import { mapGroups } from "oxalis/model/accessors/skeletontracing_accessor";
import {
  setTreeGroupAction,
  setTreeMetadataAction,
  setTreeNameAction,
  toggleAllTreesAction,
  toggleTreeAction,
  toggleTreeGroupAction,
} from "oxalis/model/actions/skeletontracing_actions";
import { api } from "oxalis/singletons";
import { Store } from "oxalis/singletons";
import type { OxalisState, Tree, TreeGroup, TreeMap } from "oxalis/store";
import {
  GroupTypeEnum,
  MISSING_GROUP_ID,
  type TreeNode,
  additionallyExpandGroup,
  createGroupToTreesMap,
  deepFlatFilter,
  findGroup,
  findParentGroupNode,
  forEachTreeNode,
  getGroupByIdWithSubgroups,
  getNodeKey,
  insertTreesAndTransform,
  moveGroupsHelper,
} from "oxalis/view/right-border-tabs/trees_tab/tree_hierarchy_view_helpers";
import React, { memo, useCallback, useEffect, useRef, useState } from "react";
import { useSelector } from "react-redux";
import AutoSizer from "react-virtualized-auto-sizer";
import type { MetadataEntryProto } from "types/api_types";
import { InputWithUpdateOnBlur } from "../../components/input_with_update_on_blur";
import { getContextMenuPositionFromEvent } from "../../context_menu";
import { MetadataEntryTableRows } from "../metadata_table";
import { ResizableSplitPane } from "../resizable_split_pane";
import ScrollableVirtualizedTree from "../scrollable_virtualized_tree";
import { ContextMenuContainer } from "../sidebar_context_menu";
import {
  type Props,
  onBatchActions,
  renderGroupNode,
  renderTreeNode,
  selectGroupById,
  setExpandedGroups,
  setUpdateTreeGroups,
} from "./tree_hierarchy_renderers";

const onCheck: TreeProps<TreeNode>["onCheck"] = (_checkedKeysValue, info) => {
  const { id, type } = info.node;

  if (type === GroupTypeEnum.TREE) {
    Store.dispatch(toggleTreeAction(id));
  } else if (id === MISSING_GROUP_ID) {
    Store.dispatch(toggleAllTreesAction());
  } else {
    Store.dispatch(toggleTreeGroupAction(id));
  }
};

function TreeHierarchyView(props: Props) {
  const [expandedNodeKeys, setExpandedNodeKeys] = useState<string[]>([]);
  const [UITreeData, setUITreeData] = useState<TreeNode[]>([]);

  const [contextMenuPosition, setContextMenuPosition] = useState<[number, number] | null>(null);
  const [menu, setMenu] = useState<MenuProps | null>(null);

  const treeRef = useRef<GetRef<typeof AntdTree>>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const activeNode = useSelector((state: OxalisState) => state.annotation.skeleton?.activeNodeId);

  useEffect(() => {
    // equivalent of LifeCycle hook "getDerivedStateFromProps"
    // Insert the trees into the corresponding groups and create a
    // groupTree object that can be rendered using a SortableTree component
    const groupToTreesMap = createGroupToTreesMap(props.trees);
    const rootGroup = {
      name: "Root",
      groupId: MISSING_GROUP_ID,
      children: props.treeGroups,
      isExpanded: true,
    };

    const generatedGroupTree = insertTreesAndTransform([rootGroup], groupToTreesMap, props.sortBy);
    setUITreeData(generatedGroupTree);
  }, [props.trees, props.sortBy, props.treeGroups]);

  useEffect(() => {
    const expandedKeys = deepFlatFilter(
      UITreeData,
      (node) => node.type === GroupTypeEnum.GROUP && node.expanded,
    ).map((node) => node.key as string);
    setExpandedNodeKeys(expandedKeys);
  }, [UITreeData]);

  useEffect(() => {
    // scroll to active tree if it changes
    if (treeRef.current && props.activeTreeId) {
      const activeTreeKey = getNodeKey(GroupTypeEnum.TREE, props.activeTreeId);

      // For some React rendering/timing reasons, the target element might not be rendered yet. That messes with calculating the offsets for scrolling. Hence delay this a bit
      setTimeout(() => {
        if (treeRef.current) treeRef.current.scrollTo({ key: activeTreeKey, align: "auto" });
      }, 50);

      // Make sure to select the active tree (for highlighting etc)
      // Remember, the active tree can be changed by actions outside of this component
      props.onSingleSelectTree(props.activeTreeId, false);
    }
  }, [props.activeTreeId, props.onSingleSelectTree]);

  useEffect(() => {
    // scroll to active group if it changes
    if (treeRef.current && props.activeGroupId) {
      const activeGroupKey = getNodeKey(GroupTypeEnum.GROUP, props.activeGroupId);
      treeRef.current.scrollTo({ key: activeGroupKey, align: "auto" });
    }
  }, [props.activeGroupId]);

  const onOpenContextMenu = (menu: MenuProps, event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();

    const [x, y] = getContextMenuPositionFromEvent(event, "tree-list-context-menu-overlay");
    showContextMenuAt(x, y, menu);
  };

  const showContextMenuAt = useCallback((xPos: number, yPos: number, menu: MenuProps) => {
    // On Windows the right click to open the context menu is also triggered for the overlay
    // of the context menu. This causes the context menu to instantly close after opening.
    // Therefore delay the state update to delay that the context menu is rendered.
    // Thus the context overlay does not get the right click as an event and therefore does not close.
    setTimeout(() => {
      setContextMenuPosition([xPos, yPos]);
      setMenu(menu);
    }, 0);
  }, []);

  const hideContextMenu = useCallback(() => {
    setContextMenuPosition(null);
    setMenu(null);
  }, []);

  const onExpand: TreeProps<TreeNode>["onExpand"] = (expandedKeys, info) => {
    const clickedNode = info.node;
    const expandedKeySet = new Set(expandedKeys as string[]);

    if (clickedNode.type === GroupTypeEnum.GROUP && info.expanded === false) {
      // when collapsing a group, we need to collapse all its sub-gropus
      const subGroupKeys = deepFlatFilter(
        [clickedNode],
        (node) => node.type === GroupTypeEnum.GROUP,
      ).map((node) => node.key as string);
      subGroupKeys.forEach((key) => expandedKeySet.delete(key));
    }
    setExpandedGroups(expandedKeySet);
  };

  function onSelectTreeNode(node: TreeNode, evt: MouseEvent) {
    const selectedTreeId = node.id;

    if (evt.ctrlKey || evt.metaKey) {
      // Select two or more individual nodes
      props.onMultiSelectTree(selectedTreeId);
    } else if (evt.shiftKey && props.activeTreeId) {
      // SHIFT click to select a whole range of nodes.
      // Selection will only work for nodes within the same group/hierarchy level.
      const sourceNode = props.trees[props.activeTreeId];
      const sourceNodeParent = findParentGroupNode(
        UITreeData,
        sourceNode.groupId ?? MISSING_GROUP_ID,
      );

      if (sourceNodeParent) {
        const rangeIndex1 = sourceNodeParent.children.findIndex(
          (node) => node.type === GroupTypeEnum.TREE && node.id === sourceNode.treeId,
        );
        const rangeIndex2 = sourceNodeParent.children.findIndex(
          (node) => node.type === GroupTypeEnum.TREE && node.id === selectedTreeId,
        );

        if (rangeIndex1 >= 0 && rangeIndex2 >= 0) {
          let selectedNodes: TreeNode[] = [];
          if (rangeIndex1 < rangeIndex2) {
            selectedNodes = sourceNodeParent.children.slice(rangeIndex1, rangeIndex2 + 1);
          } else {
            selectedNodes = sourceNodeParent.children.slice(rangeIndex2, rangeIndex1 + 1);
          }
          props.onRangeSelectTrees(selectedNodes.map((node) => node.id));
        }
      }
    } else {
      // Regular click on a single node without any multi-selection stuff.
      props.deselectAllTrees();
      props.onSingleSelectTree(selectedTreeId, true);
    }
  }

  function onSelectGroupNode(groupId: number) {
    const numberOfSelectedTrees = props.selectedTreeIds.length;

    if (numberOfSelectedTrees > 1) {
      Modal.confirm({
        title: "Do you really want to select this group?",
        content: `You have ${numberOfSelectedTrees} selected Trees. Do you really want to select this group?
        This will deselect all selected trees.`,
        onOk: () => {
          selectGroupById(props.deselectAllTrees, groupId);
        },

        onCancel() {},
      });
    } else {
      selectGroupById(props.deselectAllTrees, groupId);
    }
  }

  function onDrop(info: { node: TreeNode; dragNode: TreeNode }) {
    const { dragNode: draggedNode, node: dragTargetNode } = info;
    const parentGroupId =
      dragTargetNode.type === GroupTypeEnum.GROUP
        ? dragTargetNode.id
        : (props.trees[dragTargetNode.id].groupId ?? MISSING_GROUP_ID);

    let updatedTreeGroups: TreeGroup[] = props.treeGroups;
    if (draggedNode.type === GroupTypeEnum.TREE) {
      let allTreesToMove = [draggedNode.id];

      // Dragged nodes are not considered clicked aka "properly selected"
      // In the multi-select case, we want to move all selected trees
      if (props.selectedTreeIds.length > 1) {
        allTreesToMove = [...props.selectedTreeIds, draggedNode.id];
      }

      // Sets group of all selected + dragged trees (and the moved tree) to the new parent group
      const moveActions = allTreesToMove.map((treeId) =>
        setTreeGroupAction(parentGroupId === MISSING_GROUP_ID ? null : parentGroupId, treeId),
      );
      onBatchActions(moveActions, "SET_TREE_GROUP");
    } else {
      // A group was dragged - update the groupTree
      updatedTreeGroups = moveGroupsHelper(props.treeGroups, draggedNode.id, parentGroupId);
    }

    // in either case expand the parent group
    const newGroups = mapGroups(updatedTreeGroups, (group) => {
      if (group.groupId === parentGroupId && !group.isExpanded) {
        return { ...group, isExpanded: true };
      } else {
        return group;
      }
    });
    setUpdateTreeGroups(newGroups);
  }

  function isNodeDraggable(node: TreeNode): boolean {
    return props.allowUpdate && node.id !== MISSING_GROUP_ID;
  }

  // checkedKeys includes all nodes with a "selected" checkbox
  const checkedKeys = deepFlatFilter(UITreeData, (node) => node.isChecked).map((node) => node.key);

  // selectedKeys is mainly used for highlighting, i.e. blueish background color
  const selectedKeys = props.activeGroupId
    ? [getNodeKey(GroupTypeEnum.GROUP, props.activeGroupId)]
    : props.selectedTreeIds.map((treeId) => getNodeKey(GroupTypeEnum.TREE, treeId));

  // biome-ignore lint/correctness/useExhaustiveDependencies: The other dependencies change too often, they were omitted due to performance reasons
  useEffect(() => {
    // maybe expand group of the active tree
    if (props.activeTreeId == null) return;
    const sourceNode = props.trees[props.activeTreeId];
    if (sourceNode.groupId == null) return; // tree is a direct child of the root group which is always expanded
    const expandedGroups = additionallyExpandGroup(props.treeGroups, sourceNode.groupId, (id) =>
      getNodeKey(GroupTypeEnum.GROUP, id),
    );
    if (expandedGroups == null) return;
    const copyOfUITreeData = UITreeData;
    forEachTreeNode(UITreeData, (node) => {
      if (node.type === GroupTypeEnum.GROUP && expandedGroups.has(node.key as string))
        node.expanded = true;
    });
    setUITreeData(copyOfUITreeData);
    setTimeout(() => {
      if (treeRef.current && props.activeTreeId)
        treeRef.current.scrollTo({
          key: getNodeKey(GroupTypeEnum.TREE, props.activeTreeId),
          align: "auto",
        });
    }, 300);
  }, [activeNode]);

  useEffect(
    () => treeRef.current?.scrollTo({ key: selectedKeys[0], align: "auto" }),
    [selectedKeys[0]],
  );

  return (
    <>
      <ContextMenuContainer
        hideContextMenu={hideContextMenu}
        contextMenuPosition={contextMenuPosition}
        menu={menu}
        className="tree-list-context-menu-overlay"
      />
      <ResizableSplitPane
        firstChild={
          <AutoSizer>
            {({ height, width }) => (
              <div
                ref={wrapperRef}
                style={{
                  height,
                  width,
                }}
              >
                <ScrollableVirtualizedTree
                  treeData={UITreeData}
                  height={height}
                  ref={treeRef}
                  titleRender={(node) =>
                    node.type === GroupTypeEnum.TREE
                      ? renderTreeNode(props, onOpenContextMenu, hideContextMenu, node)
                      : renderGroupNode(
                          props,
                          onOpenContextMenu,
                          hideContextMenu,
                          node,
                          expandedNodeKeys,
                        )
                  }
                  switcherIcon={<DownOutlined />}
                  onSelect={(_selectedKeys, info: { node: TreeNode; nativeEvent: MouseEvent }) =>
                    info.node.type === GroupTypeEnum.TREE
                      ? onSelectTreeNode(info.node, info.nativeEvent)
                      : onSelectGroupNode(info.node.id)
                  }
                  onDrop={onDrop}
                  onCheck={onCheck}
                  onExpand={onExpand}
                  // @ts-expect-error isNodeDraggable has argument of base type DataNode but we use it's extended parent type TreeNode
                  draggable={{ nodeDraggable: isNodeDraggable, icon: false }}
                  checkedKeys={checkedKeys}
                  expandedKeys={expandedNodeKeys}
                  selectedKeys={selectedKeys}
                  style={{ marginLeft: -14 }}
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
        secondChild={
          <DetailsForSelection
            trees={props.trees}
            treeGroups={props.treeGroups}
            selectedTreeIds={props.selectedTreeIds}
            activeGroupId={props.activeGroupId}
            readOnly={!props.allowUpdate}
          />
        }
      />
    </>
  );
}

const setMetadata = (tree: Tree, newProperties: MetadataEntryProto[]) => {
  Store.dispatch(setTreeMetadataAction(newProperties, tree.treeId));
};

const DetailsForSelection = memo(
  ({
    trees,
    treeGroups,
    selectedTreeIds,
    readOnly,
    activeGroupId,
  }: {
    trees: TreeMap;
    treeGroups: TreeGroup[];
    selectedTreeIds: number[];
    readOnly: boolean;
    activeGroupId: number | null | undefined;
  }) => {
    if (selectedTreeIds.length === 1) {
      const tree = trees[selectedTreeIds[0]];
      if (tree == null) {
        return <>Cannot find details for selected tree.</>;
      }

      return (
        <table className="metadata-table">
          <thead>
            <SimpleRow isTableHead label="ID" value={tree.treeId} />
          </thead>
          <tbody>
            <SimpleRow
              label="Name"
              value={
                <InputWithUpdateOnBlur
                  value={tree.name || ""}
                  onChange={(newValue) => Store.dispatch(setTreeNameAction(newValue, tree.treeId))}
                />
              }
            />
            <MetadataEntryTableRows item={tree} setMetadata={setMetadata} readOnly={readOnly} />
          </tbody>
        </table>
      );
    } else if (selectedTreeIds.length > 1) {
      return (
        <div>
          {selectedTreeIds.length} {Utils.pluralize("Tree", selectedTreeIds.length)} selected.{" "}
        </div>
      );
    } else if (activeGroupId != null) {
      const activeGroup = findGroup(treeGroups, activeGroupId);
      if (!activeGroup) {
        return null;
      }

      const groupToTreesMap = createGroupToTreesMap(trees);
      const groupWithSubgroups = getGroupByIdWithSubgroups(treeGroups, activeGroupId);

      return (
        <table className="metadata-table">
          <thead>
            <SimpleRow isTableHead label="ID" value={activeGroup.groupId} />
          </thead>
          <tbody>
            <SimpleRow
              label="Name"
              value={
                <InputWithUpdateOnBlur
                  value={activeGroup.name || ""}
                  onChange={(newValue) => api.tracing.renameSkeletonGroup(activeGroupId, newValue)}
                />
              }
            />

            {groupWithSubgroups.length === 1 ? (
              <SimpleRow label="Tree Count" value={groupToTreesMap[activeGroupId]?.length ?? 0} />
            ) : (
              <>
                <SimpleRow
                  label="Tree Count (direct children)"
                  value={groupToTreesMap[activeGroupId]?.length ?? 0}
                />
                <SimpleRow
                  label="Tree Count (all children)"
                  value={_.sum(
                    groupWithSubgroups.map((groupId) => groupToTreesMap[groupId]?.length ?? 0),
                  )}
                />
              </>
            )}
          </tbody>
        </table>
      );
    }

    return null;
  },
);

// React.memo is used to prevent the component from re-rendering without the props changing
export default React.memo(TreeHierarchyView);
