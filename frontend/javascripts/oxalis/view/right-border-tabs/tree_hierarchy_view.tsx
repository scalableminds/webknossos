import { AutoSizer } from "react-virtualized";
import { Checkbox, Dropdown, MenuProps, Modal, Tooltip, notification } from "antd";
import {
  DeleteOutlined,
  PlusOutlined,
  ShrinkOutlined,
  ExpandAltOutlined,
  ArrowRightOutlined,
} from "@ant-design/icons";
import { useDispatch } from "react-redux";
import { batchActions } from "redux-batched-actions";
import React, { useState, useEffect } from "react";
import {
  ExtendedNodeData,
  FullTree,
  NodeData,
  OnDragPreviousAndNextLocation,
  OnMovePreviousAndNextLocation,
  SortableTreeWithoutDndContext as SortableTree,
} from "react-sortable-tree";
import _ from "lodash";
import type { Dispatch } from "redux";
import type { Action } from "oxalis/model/actions/actions";
import { TreeTypeEnum, type TreeType, type Vector3 } from "oxalis/constants";

import {
  getGroupByIdWithSubgroups,
  TreeNode,
  MISSING_GROUP_ID,
  TYPE_GROUP,
  TYPE_TREE,
  callDeep,
  createGroupToTreesMap,
  insertTreesAndTransform,
  makeBasicGroupObject,
  removeTreesAndTransform,
  forEachTreeNode,
  findTreeNode,
  anySatisfyDeep,
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
import { api } from "oxalis/singletons";
import { ChangeColorMenuItemContent } from "components/color_picker";
import { HideTreeEdgesIcon } from "./hide_tree_eges_icon";

const CHECKBOX_STYLE = { marginLeft: 4 };
const CHECKBOX_PLACEHOLDER_STYLE = {
  width: 16,
  display: "inline-block",
};

type Props = {
  activeTreeId: number | null | undefined;
  activeGroupId: number | null | undefined;
  treeGroups: Array<TreeGroup>;
  sortBy: string;
  trees: TreeMap;
  selectedTrees: Array<number>;
  onSelectTree: (arg0: number) => void;
  deselectAllTrees: () => void;
  onDeleteGroup: (arg0: number) => void;
  allowUpdate: boolean;
};

// type Props = OwnProps & {
//   onShuffleTreeColor: (arg0: number) => void;
//   onSetActiveTree: (arg0: number) => void;
//   onSetActiveTreeGroup: (arg0: number) => void;
//   onToggleTree: (arg0: number) => void;
//   onDeleteTree: (arg0: number) => void;
//   onToggleAllTrees: () => void;
//   onSetTreeColor: (arg0: number, arg1: Vector3) => void;
//   onToggleTreeGroup: (arg0: number) => void;
//   onUpdateTreeGroups: (arg0: Array<TreeGroup>) => void;
//   onBatchActions: (arg0: Array<Action>, arg1: string) => void;
//   onToggleHideInactiveTrees: () => void;
//   onShuffleAllTreeColors: () => void;
//   onSetTreeEdgesVisibility: (treeId: number, edgesAreVisible: boolean) => void;
//   onSetTreeType: (treeId: number, type: TreeTypeEnum) => void;
// };

export type GenerateNodePropsType = {
  title?: JSX.Element;
  className?: string;
  style?: React.CSSProperties;
};

function didTreeDataChange(prevProps: Props, nextProps: Props): boolean {
  return (
    prevProps.trees !== nextProps.trees ||
    prevProps.treeGroups !== nextProps.treeGroups ||
    prevProps.sortBy !== nextProps.sortBy
  );
}

function TreeHierarchyView(props: Props) {
  const [expandedGroupIds, setExpandedGroupIds] = useState<Record<number, boolean>>({
    [MISSING_GROUP_ID]: true,
  });
  const [groupTree, setGroupTree] = useState<TreeNode[]>([]);
  const [prevProps, setPrevProps] = useState<Props | null>(null);
  const [searchFocusOffset, setSearchFocusOffset] = useState(0);
  const [activeTreeDropdownId, setActiveTreeDropdownId] = useState<number | null>(null);
  const [activeGroupDropdownId, setActiveGroupDropdownId] = useState<number | null>(null);

  const dispatch = useDispatch();

  useEffect(() => {
    // getDerivedStateFromProps
    if (prevProps == null || didTreeDataChange(prevProps, props)) {
      // Insert the trees into the corresponding groups and create a
      // groupTree object that can be rendered using a SortableTree component
      const groupToTreesMap = createGroupToTreesMap(props.trees);
      const rootGroup = {
        name: "Root",
        groupId: MISSING_GROUP_ID,
        children: props.treeGroups,
      };

      const newExpandedGroupIds = _.cloneDeep(expandedGroupIds);

      const generatedGroupTree = insertTreesAndTransform(
        [rootGroup],
        groupToTreesMap,
        newExpandedGroupIds,
        props.sortBy,
      );
      setGroupTree(generatedGroupTree);
      setExpandedGroupIds(newExpandedGroupIds);
      setPrevProps(props);
    } else {
      setPrevProps(props);
    }
  }, [props]);

  useEffect(() => {
    // async componentDidUpdate() {
    // TODO: Workaround, remove after https://github.com/frontend-collective/react-sortable-tree/issues/305 is fixed
    // Also remove the searchFocusOffset from the state and hard-code it as 0
    if (prevProps) {
      const didSearchTermChange =
        prevProps.activeTreeId !== props.activeTreeId ||
        prevProps.activeGroupId !== props.activeGroupId;

      if (didTreeDataChange(prevProps, props) && didSearchTermChange) {
        setSearchFocusOffset(1);
      } else {
        setSearchFocusOffset(0);
      }
    }
  }, [prevProps, props]);

  // }

  function onChange(treeData: TreeNode[]) {
    const expandedGroupIds: Record<number, boolean> = {};
    forEachTreeNode(treeData, (node: TreeNode) => {
      if (node.type === TYPE_GROUP && node.expanded) expandedGroupIds[node.id] = true;
    });
    setGroupTree(treeData);
    setExpandedGroupIds(expandedGroupIds);
  }

  function onCheck(evt: React.MouseEvent<any>) {
    // @ts-expect-error ts-migrate(2339) FIXME: Property 'node' does not exist on type 'EventTarge... Remove this comment to see the full error message
    const { id, type } = evt.target.node;

    if (type === TYPE_TREE) {
      onToggleTree(parseInt(id, 10));
    } else if (id === MISSING_GROUP_ID) {
      onToggleAllTrees();
    } else {
      onToggleTreeGroup(id);
    }
  }

  function onSelectTree(evt: React.MouseEvent<any>) {
    const treeId = parseInt(evt.currentTarget.getAttribute("data-id"), 10);

    if (evt.ctrlKey || evt.metaKey) {
      props.onSelectTree(treeId);
    } else {
      props.deselectAllTrees();
      onSetActiveTree(treeId);
    }
  }

  function selectGroupById(groupId: number) {
    props.deselectAllTrees();
    onSetActiveTreeGroup(groupId);
  }

  function onSelectGroup(evt: React.MouseEvent<any>) {
    const groupId = parseInt(evt.currentTarget.getAttribute("data-id"), 10);
    const numberOfSelectedTrees = props.selectedTrees.length;

    if (numberOfSelectedTrees > 0) {
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

  function setExpansionOfAllSubgroupsTo(groupId: number, expanded: boolean) {
    const newExpandedGroupIds = Object.assign({}, expandedGroupIds);

    const collapseAllGroups = (groupTree: TreeNode[]) => {
      const copyOfGroupTree = _.cloneDeep(groupTree);

      findTreeNode(copyOfGroupTree, groupId, (item) => {
        // If we expand all subgroups, the group itself should be expanded.
        if (expanded) {
          item.expanded = expanded;
        }

        forEachTreeNode(item.children, (node) => {
          if (node.type === TYPE_GROUP) {
            node.expanded = expanded;
            newExpandedGroupIds[node.id] = expanded;
          }
        });
      });
      return copyOfGroupTree;
    };

    setGroupTree((prevgroupTree) => collapseAllGroups(prevgroupTree));
    setExpandedGroupIds(newExpandedGroupIds);
  }

  function onMoveWithContextAction(targetParentNode: TreeNode) {
    const activeComponent = getLabelForActiveItems();
    const targetGroupId = targetParentNode.id === MISSING_GROUP_ID ? null : targetParentNode.id;
    let allTreesToMove;
    if (activeComponent === "tree") {
      allTreesToMove = [props.activeTreeId];
    } else if (activeComponent === "trees") {
      allTreesToMove = props.selectedTrees;
    }
    if (allTreesToMove) {
      const moveActions = allTreesToMove.map((treeId) =>
        setTreeGroupAction(
          targetGroupId,
          // @ts-expect-error ts-migrate(2345) FIXME: Argument of type 'number' is not assignable to par... Remove this comment to see the full error message
          parseInt(treeId, 10),
        ),
      );
      onBatchActions(moveActions, "SET_TREE_GROUP");
    } else if (activeComponent === "group" && props.activeGroupId != null) {
      api.tracing.moveSkeletonGroup(props.activeGroupId, targetGroupId);
    }
  }

  function onMoveNode(
    params: NodeData<TreeNode> & FullTree<TreeNode> & OnMovePreviousAndNextLocation<TreeNode>,
  ) {
    const { nextParentNode, node, treeData } = params;
    if (node.type === TYPE_TREE && nextParentNode) {
      const allTreesToMove = [...props.selectedTrees, node.id];
      // Sets group of all selected + dragged trees (and the moved tree) to the new parent group
      const moveActions = allTreesToMove.map((treeId) =>
        setTreeGroupAction(
          nextParentNode.id === MISSING_GROUP_ID ? null : nextParentNode.id,
          treeId,
        ),
      );
      onBatchActions(moveActions, "SET_TREE_GROUP");
    } else {
      // A group was dragged - update the groupTree
      // Exclude root group and remove trees from groupTree object
      const newTreeGroups = removeTreesAndTransform(treeData[0].children);
      onUpdateTreeGroups(newTreeGroups);
    }
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

    onUpdateTreeGroups(newTreeGroups);
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

  function getNodeStyleClassForBackground(id: number) {
    const isTreeSelected = props.selectedTrees.includes(id);

    if (isTreeSelected) {
      return "selected-tree-node";
    }

    return undefined;
  }

  function handleMeasureSkeletonLength(treeId: number, treeName: string) {
    const [lengthInNm, lengthInVx] = api.tracing.measureTreeLength(treeId);
    notification.open({
      message: messages["tracing.tree_length_notification"](
        treeName,
        formatNumberToLength(lengthInNm),
        formatLengthAsVx(lengthInVx),
      ),
      icon: <i className="fas fa-ruler" />,
    });
  }

  function renderGroupActionsDropdown(node: TreeNode) {
    // The root group must not be removed or renamed
    const { id, name } = node;
    const hasExpandedSubgroup = anySatisfyDeep(
      node.children,
      (child) => child.expanded && child.type === TYPE_GROUP,
    );
    const hasCollapsedSubgroup = anySatisfyDeep(
      node.children,
      (child) => !child.expanded && child.type === TYPE_GROUP,
    );
    const isEditingDisabled = !props.allowUpdate;
    const hasSubgroup = anySatisfyDeep(node.children, (child) => child.type === TYPE_GROUP);
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
              disabled: !hasExpandedSubgroup,
              onClick: () => {
                setExpansionOfAllSubgroupsTo(id, false);
                handleGroupDropdownMenuVisibility(id, false);
              },
              icon: <ShrinkOutlined />,
              label: "Collapse all subgroups",
            }
          : null,
        hasSubgroup
          ? {
              key: "expandSubgroups",
              disabled: !hasCollapsedSubgroup,
              onClick: () => {
                setExpansionOfAllSubgroupsTo(id, true);
                handleGroupDropdownMenuVisibility(id, false);
              },
              icon: <ExpandAltOutlined />,
              label: "Expand all subgroups",
            }
          : null,
        {
          key: "hideTree",
          onClick: () => {
            onSetActiveTreeGroup(id);
            onToggleHideInactiveTrees();
            handleGroupDropdownMenuVisibility(id, false);
          },
          icon: <i className="fas fa-eye" />,
          label: "Hide/Show all other trees",
        },
        {
          key: "shuffleTreeGroupColors",
          onClick: () => {
            if (id === MISSING_GROUP_ID) onShuffleAllTreeColors();
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
      <div>
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
            {node.containsTrees ? (
              <Checkbox
                checked={node.isChecked}
                indeterminate={node.isIndeterminate}
                // @ts-expect-error ts-migrate(2322) FIXME: Type '(evt: React.MouseEvent<any>) => void' is not... Remove this comment to see the full error message
                onChange={onCheck}
                node={node}
                style={CHECKBOX_STYLE}
              />
            ) : (
              <span style={CHECKBOX_PLACEHOLDER_STYLE} />
            )}
            <span
              data-id={id}
              onClick={onSelectGroup}
              style={{
                marginLeft: 9,
              }}
            >
              {displayableName}
            </span>
          </span>
        </Dropdown>
      </div>
    );
  }

  function generateNodeProps(params: ExtendedNodeData<TreeNode>): GenerateNodePropsType {
    // This method can be used to add props to each node of the SortableTree component
    const { node } = params;
    const nodeProps: GenerateNodePropsType = {};

    if (node.type === TYPE_GROUP) {
      nodeProps.title = renderGroupActionsDropdown(node);
      nodeProps.className = "group-type";
    } else {
      // @ts-expect-error ts-migrate(2345) FIXME: Argument of type 'number' is not assignable to par... Remove this comment to see the full error message
      const tree = props.trees[parseInt(node.id, 10)];
      const rgbColorString = tree.color.map((c) => Math.round(c * 255)).join(",");
      const isEditingDisabled = !props.allowUpdate;
      const isAgglomerateSkeleton = tree.type === TreeTypeEnum.AGGLOMERATE;
      // Defining background color of current node
      const styleClass = getNodeStyleClassForBackground(node.id);

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
                    onSetTreeColor(tree.treeId, color);
                  }}
                  rgb={tree.color}
                />
              ),
            },
            {
              key: "shuffleTreeColor",
              onClick: () => onShuffleTreeColor(tree.treeId),
              title: "Shuffle Tree Color",
              disabled: isEditingDisabled,
              icon: <i className="fas fa-adjust" />,
              label: "Shuffle Tree Color",
            },
            {
              key: "deleteTree",
              onClick: () => onDeleteTree(tree.treeId),
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
                onSetActiveTree(tree.treeId);
                onToggleHideInactiveTrees();
                handleTreeDropdownMenuVisibility(tree.treeId, false);
              },
              title: "Hide/Show All Other Trees",
              icon: <i className="fas fa-eye" />,
              label: "Hide/Show All Other Trees",
            },
            {
              key: "hideTreeEdges",
              onClick: () => {
                onSetActiveTree(tree.treeId);
                onSetTreeEdgesVisibility(tree.treeId, !tree.edgesAreVisible);
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
                    onSetTreeType(tree.treeId, TreeTypeEnum.DEFAULT);
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

      nodeProps.title = (
        <div className={styleClass}>
          <Dropdown
            menu={createMenu()} //
            // AutoDestroy is used to remove the menu from DOM and keep up the performance.
            // destroyPopupOnHide should also be an option according to the docs, but
            // does not work properly. See https://github.com/react-component/trigger/issues/106#issuecomment-948532990
            // @ts-expect-error ts-migrate(2322) FIXME: Type '{ children: Element; overlay: () => Element;... Remove this comment to see the full error message
            autoDestroy
            placement="bottom"
            open={activeTreeDropdownId === tree.treeId} // explicit visibility handling is required here otherwise the color picker component for "Change Tree color" is rendered/positioned incorrectly
            onOpenChange={(isVisible, info) => {
              if (info.source === "trigger")
                handleTreeDropdownMenuVisibility(tree.treeId, isVisible);
            }}
            trigger={["contextMenu"]}
          >
            <span>
              <Checkbox
                checked={tree.isVisible}
                // @ts-expect-error ts-migrate(2322) FIXME: Type '(evt: React.MouseEvent<any>) => void' is not... Remove this comment to see the full error message
                onChange={onCheck}
                node={node}
                style={CHECKBOX_STYLE}
              />
              <div
                data-id={node.id}
                style={{
                  marginLeft: 9,
                  display: "inline",
                }}
                onClick={onSelectTree}
              >
                {`(${tree.nodes.size()}) `}
                {maybeProofreadingIcon}
                {tree.name}
              </div>
            </span>
          </Dropdown>
        </div>
      );
      nodeProps.className = "tree-type";
      nodeProps.style = {
        color: `rgb(${rgbColorString})`,
      };
    }

    return nodeProps;
  }

  function keySearchMethod(params: {
    node: TreeNode;
    searchQuery: {
      activeTreeId: number;
      activeGroupId: number;
    };
  }): boolean {
    const { node, searchQuery } = params;
    return (
      (node.type === TYPE_TREE && node.id === searchQuery.activeTreeId) ||
      (node.type === TYPE_GROUP && node.id === searchQuery.activeGroupId)
    );
  }

  function getNodeKey({ node }: { node: TreeNode }): number {
    // The hierarchical tree contains group and tree nodes which share ids. To generate a unique
    // id number, use the [-1, ...] range for the group ids and the [..., -2] range for the tree ids.
    return node.type === TYPE_GROUP ? node.id : -1 - node.id;
  }

  function canDrop(params: OnDragPreviousAndNextLocation<TreeNode> & NodeData<TreeNode>) {
    const { nextParent } = params;
    return props.allowUpdate && nextParent != null && nextParent.type === TYPE_GROUP;
  }

  function canDrag(params: ExtendedNodeData): boolean {
    const node = params.node as TreeNode;
    return props.allowUpdate && node.id !== MISSING_GROUP_ID;
  }

  function canNodeHaveChildren(node: TreeNode) {
    return node.type === TYPE_GROUP;
  }

  function getLabelForActiveItems(): "trees" | "tree" | "group" | null {
    // Only one type of component can be selected. It is not possible to select multiple groups.
    if (props.selectedTrees.length > 0) {
      return "trees";
    } else if (props.activeTreeId != null) {
      return "tree";
    } else if (props.activeGroupId != null) {
      return "group";
    }
    return null;
  }

  const { activeTreeId, activeGroupId } = props;
  return (
    <AutoSizer>
      {({ height, width }) => (
        <div
          style={{
            height,
            width,
          }}
        >
          <SortableTree
            treeData={groupTree}
            onChange={onChange}
            onMoveNode={onMoveNode}
            searchMethod={keySearchMethod}
            searchQuery={{
              activeTreeId,
              activeGroupId,
            }}
            getNodeKey={getNodeKey}
            generateNodeProps={generateNodeProps}
            canDrop={canDrop}
            canDrag={canDrag}
            canNodeHaveChildren={canNodeHaveChildren}
            rowHeight={24}
            innerStyle={{
              padding: 0,
            }}
            scaffoldBlockPxWidth={25}
            searchFocusOffset={searchFocusOffset}
            reactVirtualizedListProps={{
              scrollToAlignment: "auto",
              tabIndex: null,
              height,
              width,
            }}
          />
        </div>
      )}
    </AutoSizer>
  );

  function onSetActiveTree(treeId: number) {
    dispatch(setActiveTreeAction(treeId));
  }

  function onSetActiveTreeGroup(groupId: number) {
    dispatch(setActiveTreeGroupAction(groupId));
  }

  function onSetTreeColor(treeId: number, color: Vector3) {
    dispatch(setTreeColorAction(treeId, color));
  }

  function onShuffleTreeColor(treeId: number) {
    dispatch(shuffleTreeColorAction(treeId));
  }

  function onDeleteTree(treeId: number) {
    dispatch(deleteTreeAction(treeId));
  }

  function onToggleTree(treeId: number) {
    dispatch(toggleTreeAction(treeId));
  }

  function onSetTreeEdgesVisibility(treeId: number, edgesAreVisible: boolean) {
    dispatch(setTreeEdgeVisibilityAction(treeId, edgesAreVisible));
  }

  function onToggleTreeGroup(groupId: number) {
    dispatch(toggleTreeGroupAction(groupId));
  }

  function onToggleAllTrees() {
    dispatch(toggleAllTreesAction());
  }

  function onUpdateTreeGroups(treeGroups: TreeGroup[]) {
    dispatch(setTreeGroupsAction(treeGroups));
  }

  function onBatchActions(actions: Array<Action>, actionName: string) {
    dispatch(batchActions(actions, actionName));
  }

  function onToggleHideInactiveTrees() {
    dispatch(toggleInactiveTreesAction());
  }

  function onShuffleAllTreeColors() {
    dispatch(shuffleAllTreeColorsAction());
  }

  function onSetTreeType(treeId: number, type: TreeType) {
    dispatch(setTreeTypeAction(treeId, type));
  }
}

export default TreeHierarchyView;
