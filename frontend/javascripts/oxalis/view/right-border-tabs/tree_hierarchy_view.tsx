import { AutoSizer } from "react-virtualized";
import {
  Dropdown,
  MenuProps,
  Modal,
  Tooltip,
  notification,
  Tree as AndTree,
  GetRef,
  TreeProps,
} from "antd";
import {
  DeleteOutlined,
  PlusOutlined,
  ShrinkOutlined,
  ExpandAltOutlined,
  ArrowRightOutlined,
  DownOutlined,
  FolderOutlined,
} from "@ant-design/icons";
import { useDispatch } from "react-redux";
import { batchActions } from "redux-batched-actions";
import React, { useState, useEffect, useRef } from "react";
import _ from "lodash";
import type { Action } from "oxalis/model/actions/actions";
import {
  TreeTypeEnum,
  LongUnitToShortUnitMap,
  type TreeType,
  type Vector3,
} from "oxalis/constants";

import {
  getGroupByIdWithSubgroups,
  TreeNode,
  MISSING_GROUP_ID,
  callDeep,
  createGroupToTreesMap,
  insertTreesAndTransform,
  makeBasicGroupObject,
  anySatisfyDeep,
  GroupTypeEnum,
  deepFlatFilter,
  getNodeKey,
  moveGroupsHelper,
  findParentGroupNode,
} from "oxalis/view/right-border-tabs/tree_hierarchy_view_helpers";
import type { TreeMap, TreeGroup } from "oxalis/store";
import { getMaximumGroupId } from "oxalis/model/reducers/skeletontracing_reducer_helpers";
import {
  setActiveTreeAction,
  setActiveTreeGroupAction,
  setTreeColorAction,
  toggleTreeAction,
  toggleTreeGroupAction,
  toggleAllTreesAction,
  setTreeGroupsAction,
  shuffleTreeColorAction,
  setTreeGroupAction,
  deleteTreeAction,
  toggleInactiveTreesAction,
  shuffleAllTreeColorsAction,
  setTreeEdgeVisibilityAction,
  setTreeTypeAction,
} from "oxalis/model/actions/skeletontracing_actions";
import messages from "messages";
import { formatNumberToLength, formatLengthAsVx } from "libs/format_utils";
import { api, Store } from "oxalis/singletons";
import { ChangeColorMenuItemContent } from "components/color_picker";
import { HideTreeEdgesIcon } from "./hide_tree_eges_icon";
import { ColoredDotIcon } from "./segments_tab/segment_list_item";
import { mapGroups } from "oxalis/model/accessors/skeletontracing_accessor";

type Props = {
  activeTreeId: number | null | undefined;
  activeGroupId: number | null | undefined;
  treeGroups: TreeGroup[];
  sortBy: string;
  trees: TreeMap;
  selectedTreeIds: number[];
  onSingleSelectTree: (treeId: number) => void;
  onMultiSelectTree: (treeId: number) => void;
  onRangeSelectTrees: (treeIds: number[]) => void;
  deselectAllTrees: () => void;
  onDeleteGroup: (arg0: number) => void;
  allowUpdate: boolean;
};

function TreeHierarchyView(props: Props) {
  const [expandedNodeKeys, setExpandedNodeKeys] = useState<React.Key[]>([]);
  const [UITreeData, setUITreeData] = useState<TreeNode[]>([]);
  const [activeTreeDropdownId, setActiveTreeDropdownId] = useState<number | null>(null);
  const [activeGroupDropdownId, setActiveGroupDropdownId] = useState<number | null>(null);

  const treeRef = useRef<GetRef<typeof AndTree>>(null);

  const dispatch = useDispatch();

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
    ).map((node) => node.key);
    setExpandedNodeKeys(expandedKeys);
  }, [UITreeData]);

  useEffect(() => {
    // scroll to active tree if it changes
    if (treeRef.current && props.activeTreeId) {
      const activeTreeKey = getNodeKey(GroupTypeEnum.TREE, props.activeTreeId);

      // For some React rendering/timing  reasons, the target element might  not be rendered yet. That messes with calculcating the offsets for srolling. Hence delay this a bit
      setTimeout(() => {
        if (treeRef.current) treeRef.current.scrollTo({ key: activeTreeKey, align: "auto" });
      });
      
      // Make sure to select the active tree (for highlighting etc)
      // Remember, the active tree can be changed by actions outside of this component
      props.onSingleSelectTree(props.activeTreeId);
    }
  }, [props.activeTreeId, props.onSingleSelectTree]);
  
  useEffect(() => {
    // scroll to active group if it changes
    if (treeRef.current && props.activeGroupId) {
      const activeGroupKey = getNodeKey(GroupTypeEnum.GROUP, props.activeGroupId);
      treeRef.current.scrollTo({ key: activeGroupKey, align: "auto" });
    }
  }, [props.activeGroupId]);

  const onExpand: TreeProps<TreeNode>["onExpand"] = (expandedKeys, info) => {
    const clickedNode = info.node;
    const expandedKeySet = new Set(expandedKeys);

    if (clickedNode.type === GroupTypeEnum.GROUP && info.expanded === false) {
      // when collapsing a group, we need to collapse all its sub-gropus
      const subGroupKeys = deepFlatFilter(
        [clickedNode],
        (node) => node.type === GroupTypeEnum.GROUP,
      ).map((node) => node.key);
      subGroupKeys.forEach((key) => expandedKeySet.delete(key));
    }
    const newGroups = mapGroups(props.treeGroups, (group) => {
      const shouldBeExpanded = expandedKeySet.has(getNodeKey(GroupTypeEnum.GROUP, group.groupId));
      if (shouldBeExpanded !== group.isExpanded) {
        return { ...group, isExpanded: shouldBeExpanded };
      } else {
        return group;
      }
    });
    setUpdateTreeGroups(newGroups);
  };

  const onCheck: TreeProps<TreeNode>["onCheck"] = (_checkedKeysValue, info) => {
    const { id, type } = info.node;

    if (type === GroupTypeEnum.TREE) {
      toggleTree(id);
    } else if (id === MISSING_GROUP_ID) {
      setToggleAllTrees();
    } else {
      toggleTreeGroup(id);
    }
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
      props.onSingleSelectTree(selectedTreeId);
    }
  }

  function selectGroupById(groupId: number) {
    props.deselectAllTrees();
    setActiveTreeGroup(groupId);
  }

  function onSelectGroupNode(node: TreeNode) {
    const groupId = node.id;
    const numberOfSelectedTrees = props.selectedTreeIds.length;

    if (numberOfSelectedTrees > 1) {
      Modal.confirm({
        title: "Do you really want to select this group?",
        content: `You have ${numberOfSelectedTrees} selected Trees. Do you really want to select this group?
        This will deselect all selected trees.`,
        onOk: () => {
          selectGroupById(groupId);
        },

        onCancel() {},
      });
    } else {
      selectGroupById(groupId);
    }
  }

  function setExpansionOfAllSubgroupsTo(parentGroup: TreeNode, expanded: boolean) {
    if (parentGroup.id === MISSING_GROUP_ID) {
      const newGroups = mapGroups(props.treeGroups, (group) => {
        if (group.isExpanded !== expanded) {
          return { ...group, isExpanded: expanded };
        }
        return group;
      });
      setUpdateTreeGroups(newGroups);
      return;
    }
    const subGroups = getGroupByIdWithSubgroups(props.treeGroups, parentGroup.id);
    const subGroupsMap = new Set(subGroups);
    // If the subgroups should be collapsed, do not collapse the group itself.
    // Do expand the group if the subgroups are expanded though.
    if (expanded === false) subGroupsMap.delete(parentGroup.id);
    const newGroups = mapGroups(props.treeGroups, (group) => {
      if (subGroupsMap.has(group.groupId) && expanded !== group.isExpanded) {
        return { ...group, isExpanded: expanded };
      } else {
        return group;
      }
    });
    setUpdateTreeGroups(newGroups);
  }

  function onMoveWithContextAction(targetParentNode: TreeNode) {
    const activeComponent = getLabelForActiveItems();
    const targetGroupId = targetParentNode.id === MISSING_GROUP_ID ? null : targetParentNode.id;
    let allTreesToMove;
    if (activeComponent === "tree") {
      allTreesToMove = [props.activeTreeId];
    } else if (activeComponent === "trees") {
      allTreesToMove = props.selectedTreeIds;
    }
    if (allTreesToMove) {
      const moveActions = allTreesToMove.map((treeId) =>
        setTreeGroupAction(
          targetGroupId,
          // @ts-expect-error ts-migrate(2345) FIXME: Argument of type 'number' is not assignable to par... Remove this comment to see the full error message
          treeId,
        ),
      );
      onBatchActions(moveActions, "SET_TREE_GROUP");
    } else if (activeComponent === "group" && props.activeGroupId != null) {
      api.tracing.moveSkeletonGroup(props.activeGroupId, targetGroupId);
    }
  }

  function onDrop(info: { node: TreeNode; dragNode: TreeNode }) {
    const { dragNode: draggedNode, node: dragTargetNode } = info;
    const parentGroupId =
      dragTargetNode.type === GroupTypeEnum.GROUP
        ? dragTargetNode.id
        : props.trees[dragTargetNode.id].groupId ?? MISSING_GROUP_ID;

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

  function createGroup(groupId: number) {
    const newTreeGroups = _.cloneDeep(props.treeGroups);

    const newGroupId = getMaximumGroupId(newTreeGroups) + 1;
    const newGroup = makeBasicGroupObject(newGroupId, `Group ${newGroupId}`);

    if (groupId === MISSING_GROUP_ID) {
      newTreeGroups.push(newGroup);
    } else {
      callDeep(newTreeGroups, groupId, (item) => {
        item.children.push(newGroup);
      });
    }

    setUpdateTreeGroups(newTreeGroups);
    selectGroupById(newGroupId);
  }

  function deleteGroup(groupId: number) {
    props.onDeleteGroup(groupId);
  }

  function shuffleTreeGroupColors(groupId: number) {
    const groupToTreeMap = createGroupToTreesMap(props.trees);
    const groupIdWithSubgroups = getGroupByIdWithSubgroups(props.treeGroups, groupId);
    const shuffleTreeColorActions = groupIdWithSubgroups.flatMap((subGroupId) => {
      if (subGroupId in groupToTreeMap)
        return groupToTreeMap[subGroupId].map((tree) => shuffleTreeColorAction(tree.treeId));
      return [];
    });
    onBatchActions(shuffleTreeColorActions, "SHUFFLE_TREE_COLOR");
  }

  function setTreeGroupColor(groupId: number, color: Vector3) {
    const groupToTreeMap = createGroupToTreesMap(props.trees);
    const groupIdWithSubgroups = getGroupByIdWithSubgroups(props.treeGroups, groupId);
    const setTreeColorActions = groupIdWithSubgroups.flatMap((subGroupId) => {
      if (subGroupId in groupToTreeMap)
        return groupToTreeMap[subGroupId].map((tree) => setTreeColorAction(tree.treeId, color));
      return [];
    });
    onBatchActions(setTreeColorActions, "SET_TREE_COLOR");
  }

  function setAllTreesColor(color: Vector3) {
    const setTreeColorActions = Object.values(props.trees).map((tree) =>
      setTreeColorAction(tree.treeId, color),
    );
    onBatchActions(setTreeColorActions, "SET_TREE_COLOR");
  }

  function handleTreeDropdownMenuVisibility(treeId: number, isVisible: boolean) {
    if (isVisible) {
      setActiveTreeDropdownId(treeId);
      return;
    }

    setActiveTreeDropdownId(null);
  }

  function handleGroupDropdownMenuVisibility(groupId: number, isVisible: boolean) {
    if (isVisible) {
      setActiveGroupDropdownId(groupId);
      return;
    }

    setActiveGroupDropdownId(null);
  }

  function handleMeasureSkeletonLength(treeId: number, treeName: string) {
    const dataSourceUnit = Store.getState().dataset.dataSource.scale.unit;
    const [lengthInUnit, lengthInVx] = api.tracing.measureTreeLength(treeId);

    notification.open({
      message: messages["tracing.tree_length_notification"](
        treeName,
        formatNumberToLength(lengthInUnit, LongUnitToShortUnitMap[dataSourceUnit]),
        formatLengthAsVx(lengthInVx),
      ),
      icon: <i className="fas fa-ruler" />,
    });
  }

  function renderGroupNode(node: TreeNode) {
    // The root group must not be removed or renamed
    const { id, name } = node;

    const isEditingDisabled = !props.allowUpdate;
    const hasSubgroup = anySatisfyDeep(
      node.children,
      (child) => child.type === GroupTypeEnum.GROUP,
    );
    const labelForActiveItems = getLabelForActiveItems();
    const menu: MenuProps = {
      items: [
        {
          key: "create",
          onClick: () => {
            createGroup(id);
            handleGroupDropdownMenuVisibility(id, false);
          },
          disabled: isEditingDisabled,
          icon: <PlusOutlined />,
          label: "Create new group",
        },
        labelForActiveItems != null
          ? {
              key: "moveHere",
              onClick: () => {
                onMoveWithContextAction(node);
                handleGroupDropdownMenuVisibility(id, false);
              },
              disabled: isEditingDisabled,
              icon: <ArrowRightOutlined />,
              label: `Move active ${labelForActiveItems} here`,
            }
          : null,
        {
          key: "delete",
          disabled: isEditingDisabled,
          onClick: () => deleteGroup(id),
          icon: <DeleteOutlined />,
          label: "Delete group",
        },
        hasSubgroup
          ? {
              key: "collapseSubgroups",
              onClick: () => {
                setExpansionOfAllSubgroupsTo(node, false);
                handleGroupDropdownMenuVisibility(id, false);
              },
              icon: <ShrinkOutlined />,
              label: "Collapse all subgroups",
            }
          : null,
        hasSubgroup
          ? {
              key: "expandSubgroups",
              onClick: () => {
                setExpansionOfAllSubgroupsTo(node, true);
                handleGroupDropdownMenuVisibility(id, false);
              },
              icon: <ExpandAltOutlined />,
              label: "Expand all subgroups",
            }
          : null,
        {
          key: "hideTree",
          onClick: () => {
            setActiveTreeGroup(id);
            toggleHideInactiveTrees();
            handleGroupDropdownMenuVisibility(id, false);
          },
          icon: <i className="fas fa-eye" />,
          label: "Hide/Show all other trees",
        },
        {
          key: "shuffleTreeGroupColors",
          onClick: () => {
            if (id === MISSING_GROUP_ID) shuffleAllTreeColors();
            else shuffleTreeGroupColors(id);
          },
          icon: <i className="fas fa-adjust" />,
          label: "Shuffle Tree Group Colors",
        },
        {
          key: "setTreeGroupColor",
          disabled: isEditingDisabled,
          icon: <i className="fas fa-eye-dropper fa-sm " />,
          label: (
            <ChangeColorMenuItemContent
              title="Change Tree Group Color"
              isDisabled={isEditingDisabled}
              onSetColor={(color) => {
                if (id === MISSING_GROUP_ID) setAllTreesColor(color);
                else setTreeGroupColor(id, color);
              }}
              rgb={[0.5, 0.5, 0.5]}
            />
          ),
        },
      ],
    };

    // Make sure the displayed name is not empty
    const displayableName = name.trim() || "<Unnamed Group>";
    return (
      <Dropdown
        menu={menu}
        placement="bottom"
        // AutoDestroy is used to remove the menu from DOM and keep up the performance.
        // destroyPopupOnHide should also be an option according to the docs, but
        // does not work properly. See https://github.com/react-component/trigger/issues/106#issuecomment-948532990
        // @ts-expect-error ts-migrate(2322) FIXME: Type '{ children: Element; overlay: () => Element;... Remove this comment to see the full error message
        autoDestroy
        open={activeGroupDropdownId === id} // explicit visibility handling is required here otherwise the color picker component for "Change Tree color" is rendered/positioned incorrectly
        onOpenChange={(isVisible, info) => {
          if (info.source === "trigger") handleGroupDropdownMenuVisibility(id, isVisible);
        }}
        trigger={["contextMenu"]}
      >
        <span>
          <FolderOutlined className="icon-margin-right" />
          {displayableName}
        </span>
      </Dropdown>
    );
  }

  function renderTreeNode(node: TreeNode): React.ReactNode {
    const tree = props.trees[node.id];
    if (!tree) return null;

    const isEditingDisabled = !props.allowUpdate;
    const isAgglomerateSkeleton = tree.type === TreeTypeEnum.AGGLOMERATE;
    const isDropdownVisible = activeTreeDropdownId === tree.treeId;

    const createMenu = (): MenuProps => {
      return {
        items: [
          {
            key: "changeTreeColor",
            disabled: isEditingDisabled,
            icon: <i className="fas fa-eye-dropper fa-sm " />,
            label: (
              <ChangeColorMenuItemContent
                title="Change Tree Color"
                isDisabled={isEditingDisabled}
                onSetColor={(color) => {
                  setTreeColor(tree.treeId, color);
                }}
                rgb={tree.color}
              />
            ),
          },
          {
            key: "shuffleTreeColor",
            onClick: () => shuffleTreeColor(tree.treeId),
            title: "Shuffle Tree Color",
            disabled: isEditingDisabled,
            icon: <i className="fas fa-adjust" />,
            label: "Shuffle Tree Color",
          },
          {
            key: "deleteTree",
            onClick: () => deleteTree(tree.treeId),
            title: "Delete Tree",
            disabled: isEditingDisabled,
            icon: <i className="fas fa-trash" />,
            label: "Delete Tree",
          },
          {
            key: "measureSkeleton",
            onClick: () => {
              handleMeasureSkeletonLength(tree.treeId, tree.name);
              handleTreeDropdownMenuVisibility(tree.treeId, false);
            },
            title: "Measure Tree Length",
            icon: <i className="fas fa-ruler" />,
            label: "Measure Tree Length",
          },
          {
            key: "hideTree",
            onClick: () => {
              setActiveTree(tree.treeId);
              toggleHideInactiveTrees();
              handleTreeDropdownMenuVisibility(tree.treeId, false);
            },
            title: "Hide/Show All Other Trees",
            icon: <i className="fas fa-eye" />,
            label: "Hide/Show All Other Trees",
          },
          {
            key: "hideTreeEdges",
            onClick: () => {
              setActiveTree(tree.treeId);
              setTreeEdgesVisibility(tree.treeId, !tree.edgesAreVisible);
              handleTreeDropdownMenuVisibility(tree.treeId, false);
            },
            title: "Hide/Show Edges of This Tree",
            icon: <HideTreeEdgesIcon />,
            label: "Hide/Show Edges of This Tree",
          },
          isAgglomerateSkeleton
            ? {
                key: "convertToNormalSkeleton",
                onClick: () => {
                  setTreeType(tree.treeId, TreeTypeEnum.DEFAULT);
                  handleTreeDropdownMenuVisibility(tree.treeId, false);
                },
                title: "Convert to Normal Tree",
                icon: <span className="fas fa-clipboard-check" />,
                label: "Convert to Normal Tree",
              }
            : null,
        ],
      };
    };

    const maybeProofreadingIcon =
      tree.type === TreeTypeEnum.AGGLOMERATE ? (
        <Tooltip title="Agglomerate Skeleton">
          <i className="fas fa-clipboard-check icon-margin-right" />
        </Tooltip>
      ) : null;

    return (
      <Dropdown
        // only render the menu items when the dropdown menu is visible. Maybe this helps performance
        menu={isDropdownVisible ? createMenu() : { items: [] }} //
        // AutoDestroy is used to remove the menu from DOM and keep up the performance.
        // destroyPopupOnHide should also be an option according to the docs, but
        // does not work properly. See https://github.com/react-component/trigger/issues/106#issuecomment-948532990
        // @ts-expect-error ts-migrate(2322) FIXME: Type '{ children: Element; overlay: () => Element;... Remove this comment to see the full error message
        autoDestroy
        placement="bottom"
        open={isDropdownVisible} // explicit visibility handling is required here otherwise the color picker component for "Change Tree color" is rendered/positioned incorrectly
        onOpenChange={(isVisible, info) => {
          if (info.source === "trigger") handleTreeDropdownMenuVisibility(tree.treeId, isVisible);
        }}
        trigger={["contextMenu"]}
      >
        <div className="nowrap">
          <ColoredDotIcon colorRGBA={[...tree.color, 1.0]} />
          {`(${tree.nodes.size()}) `} {maybeProofreadingIcon} {tree.name}
        </div>
      </Dropdown>
    );
  }

  function isNodeDraggable(node: TreeNode): boolean {
    return props.allowUpdate && node.id !== MISSING_GROUP_ID;
  }

  function getLabelForActiveItems(): "trees" | "tree" | "group" | null {
    // Only one type of component can be selected. It is not possible to select multiple groups.
    if (props.selectedTreeIds.length > 0) {
      return "trees";
    } else if (props.activeTreeId != null) {
      return "tree";
    } else if (props.activeGroupId != null) {
      return "group";
    }
    return null;
  }

  // checkedKeys includes all nodes with a "selected" checkbox
  const checkedKeys = deepFlatFilter(UITreeData, (node) => node.isChecked).map((node) => node.key);

  // selectedKeys is mainly used for highlighting, i.e. blueish background color
  const selectedKeys = props.selectedTreeIds.map((treeId) =>
    getNodeKey(GroupTypeEnum.TREE, treeId),
  );

  if (props.activeGroupId) selectedKeys.push(getNodeKey(GroupTypeEnum.GROUP, props.activeGroupId));

  return (
    <AutoSizer>
      {({ height, width }) => (
        <div
          style={{
            height,
            width,
          }}
        >
          <AndTree
            treeData={UITreeData}
            height={height}
            ref={treeRef}
            titleRender={(node) =>
              node.type === GroupTypeEnum.TREE ? renderTreeNode(node) : renderGroupNode(node)
            }
            switcherIcon={<DownOutlined />}
            onSelect={(_selectedKeys, info: { node: TreeNode; nativeEvent: MouseEvent }) =>
              info.node.type === GroupTypeEnum.TREE
                ? onSelectTreeNode(info.node, info.nativeEvent)
                : onSelectGroupNode(info.node)
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
  );

  function setActiveTree(treeId: number) {
    dispatch(setActiveTreeAction(treeId));
  }

  function setActiveTreeGroup(groupId: number) {
    dispatch(setActiveTreeGroupAction(groupId));
  }

  function setTreeColor(treeId: number, color: Vector3) {
    dispatch(setTreeColorAction(treeId, color));
  }

  function shuffleTreeColor(treeId: number) {
    dispatch(shuffleTreeColorAction(treeId));
  }

  function deleteTree(treeId: number) {
    props.deselectAllTrees();
    dispatch(deleteTreeAction(treeId));
  }

  function toggleTree(treeId: number) {
    dispatch(toggleTreeAction(treeId));
  }

  function setTreeEdgesVisibility(treeId: number, edgesAreVisible: boolean) {
    dispatch(setTreeEdgeVisibilityAction(treeId, edgesAreVisible));
  }

  function toggleTreeGroup(groupId: number) {
    dispatch(toggleTreeGroupAction(groupId));
  }

  function setToggleAllTrees() {
    dispatch(toggleAllTreesAction());
  }

  function setUpdateTreeGroups(treeGroups: TreeGroup[]) {
    dispatch(setTreeGroupsAction(treeGroups));
  }

  function onBatchActions(actions: Action[], actionName: string) {
    dispatch(batchActions(actions, actionName));
  }

  function toggleHideInactiveTrees() {
    dispatch(toggleInactiveTreesAction());
  }

  function shuffleAllTreeColors() {
    dispatch(shuffleAllTreeColorsAction());
  }

  function setTreeType(treeId: number, type: TreeType) {
    dispatch(setTreeTypeAction(treeId, type));
  }
}

// React.memo is used to prevent the component from re-rendering without the props changing
export default React.memo(TreeHierarchyView);
