import { AutoSizer } from "react-virtualized";
import { Checkbox, Dropdown, MenuProps, Modal, Tooltip, notification } from "antd";
import {
  DeleteOutlined,
  PlusOutlined,
  ShrinkOutlined,
  ExpandAltOutlined,
  ArrowRightOutlined,
} from "@ant-design/icons";
import { connect } from "react-redux";
import { batchActions } from "redux-batched-actions";
import React from "react";
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
import { formatNumberInNmToLength, formatLengthAsVx } from "libs/format_utils";
import { api } from "oxalis/singletons";
import { ChangeColorMenuItemContent } from "components/color_picker";
import { HideTreeEdgesIcon } from "./hide_tree_eges_icon";

const CHECKBOX_STYLE = { marginLeft: 4 };
const CHECKBOX_PLACEHOLDER_STYLE = {
  width: 16,
  display: "inline-block",
};
type OwnProps = {
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
type Props = OwnProps & {
  onShuffleTreeColor: (arg0: number) => void;
  onSetActiveTree: (arg0: number) => void;
  onSetActiveTreeGroup: (arg0: number) => void;
  onToggleTree: (arg0: number) => void;
  onDeleteTree: (arg0: number) => void;
  onToggleAllTrees: () => void;
  onSetTreeColor: (arg0: number, arg1: Vector3) => void;
  onToggleTreeGroup: (arg0: number) => void;
  onUpdateTreeGroups: (arg0: Array<TreeGroup>) => void;
  onBatchActions: (arg0: Array<Action>, arg1: string) => void;
  onToggleHideInactiveTrees: () => void;
  onShuffleAllTreeColors: () => void;
  onSetTreeEdgesVisibility: (treeId: number, edgesAreVisible: boolean) => void;
  onSetTreeType: (treeId: number, type: TreeTypeEnum) => void;
};
type State = {
  prevProps: Props | null | undefined;
  expandedGroupIds: Record<number, boolean>;
  groupTree: Array<TreeNode>;
  searchFocusOffset: number;
  activeTreeDropdownId: number | null | undefined;
  activeGroupDropdownId: number | null | undefined;
};

export type GenerateNodePropsType = {
  title?: JSX.Element;
  className?: string;
  style?: React.CSSProperties;
};

const didTreeDataChange = (prevProps: Props, nextProps: Props): boolean =>
  prevProps.trees !== nextProps.trees ||
  prevProps.treeGroups !== nextProps.treeGroups ||
  prevProps.sortBy !== nextProps.sortBy;

class TreeHierarchyView extends React.PureComponent<Props, State> {
  state: State = {
    expandedGroupIds: {
      [MISSING_GROUP_ID]: true,
    },
    groupTree: [],
    prevProps: null,
    searchFocusOffset: 0,
    activeTreeDropdownId: null,
    activeGroupDropdownId: null,
  };

  static getDerivedStateFromProps(nextProps: Props, prevState: State) {
    if (prevState.prevProps == null || didTreeDataChange(prevState.prevProps, nextProps)) {
      // Insert the trees into the corresponding groups and create a
      // groupTree object that can be rendered using a SortableTree component
      const groupToTreesMap = createGroupToTreesMap(nextProps.trees);
      const rootGroup = {
        name: "Root",
        groupId: MISSING_GROUP_ID,
        children: nextProps.treeGroups,
      };

      const expandedGroupIds = _.cloneDeep(prevState.expandedGroupIds);

      const generatedGroupTree = insertTreesAndTransform(
        [rootGroup],
        groupToTreesMap,
        expandedGroupIds,
        nextProps.sortBy,
      );
      return {
        groupTree: generatedGroupTree,
        expandedGroupIds,
        prevProps: nextProps,
      };
    } else {
      return {
        prevProps: nextProps,
      };
    }
  }

  async componentDidUpdate(prevProps: Props) {
    // TODO: Workaround, remove after https://github.com/frontend-collective/react-sortable-tree/issues/305 is fixed
    // Also remove the searchFocusOffset from the state and hard-code it as 0
    const didSearchTermChange =
      prevProps.activeTreeId !== this.props.activeTreeId ||
      prevProps.activeGroupId !== this.props.activeGroupId;

    if (didTreeDataChange(prevProps, this.props) && didSearchTermChange) {
      this.setState({
        searchFocusOffset: 1,
      });
      this.setState({
        searchFocusOffset: 0,
      });
    }
  }

  onChange = (treeData: Array<TreeNode>) => {
    const expandedGroupIds: Record<number, boolean> = {};
    forEachTreeNode(treeData, (node: TreeNode) => {
      if (node.type === TYPE_GROUP && node.expanded) expandedGroupIds[node.id] = true;
    });
    this.setState({
      groupTree: treeData,
      expandedGroupIds,
    });
  };

  onCheck = (evt: React.MouseEvent<any>) => {
    // @ts-expect-error ts-migrate(2339) FIXME: Property 'node' does not exist on type 'EventTarge... Remove this comment to see the full error message
    const { id, type } = evt.target.node;

    if (type === TYPE_TREE) {
      this.props.onToggleTree(parseInt(id, 10));
    } else if (id === MISSING_GROUP_ID) {
      this.props.onToggleAllTrees();
    } else {
      this.props.onToggleTreeGroup(id);
    }
  };

  onSelectTree = (evt: React.MouseEvent<any>) => {
    const treeId = parseInt(evt.currentTarget.getAttribute("data-id"), 10);

    if (evt.ctrlKey || evt.metaKey) {
      this.props.onSelectTree(treeId);
    } else {
      this.props.deselectAllTrees();
      this.props.onSetActiveTree(treeId);
    }
  };

  selectGroupById = (groupId: number) => {
    this.props.deselectAllTrees();
    this.props.onSetActiveTreeGroup(groupId);
  };

  onSelectGroup = (evt: React.MouseEvent<any>) => {
    const groupId = parseInt(evt.currentTarget.getAttribute("data-id"), 10);
    const numberOfSelectedTrees = this.props.selectedTrees.length;

    if (numberOfSelectedTrees > 0) {
      Modal.confirm({
        title: "Do you really want to select this group?",
        content: `You have ${numberOfSelectedTrees} selected Trees. Do you really want to select this group?
        This will deselect all selected trees.`,
        onOk: () => {
          this.selectGroupById(groupId);
        },

        onCancel() {},
      });
    } else {
      this.selectGroupById(groupId);
    }
  };

  setExpansionOfAllSubgroupsTo = (groupId: number, expanded: boolean) => {
    const newExpandedGroupIds = Object.assign({}, this.state.expandedGroupIds);

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

    this.setState((prevState) => ({
      groupTree: collapseAllGroups(prevState.groupTree),
      expandedGroupIds: newExpandedGroupIds,
    }));
  };

  onMoveWithContextAction = (targetParentNode: TreeNode) => {
    const activeComponent = this.getLabelForActiveItems();
    const targetGroupId = targetParentNode.id === MISSING_GROUP_ID ? null : targetParentNode.id;
    let allTreesToMove;
    if (activeComponent === "tree") {
      allTreesToMove = [this.props.activeTreeId];
    } else if (activeComponent === "trees") {
      allTreesToMove = this.props.selectedTrees;
    }
    if (allTreesToMove) {
      const moveActions = allTreesToMove.map((treeId) =>
        setTreeGroupAction(
          targetGroupId,
          // @ts-expect-error ts-migrate(2345) FIXME: Argument of type 'number' is not assignable to par... Remove this comment to see the full error message
          parseInt(treeId, 10),
        ),
      );
      this.props.onBatchActions(moveActions, "SET_TREE_GROUP");
    } else if (activeComponent === "group" && this.props.activeGroupId != null) {
      api.tracing.moveSkeletonGroup(this.props.activeGroupId, targetGroupId);
    }
  };

  onMoveNode = (
    params: NodeData<TreeNode> & FullTree<TreeNode> & OnMovePreviousAndNextLocation<TreeNode>,
  ) => {
    const { nextParentNode, node, treeData } = params;
    if (node.type === TYPE_TREE && nextParentNode) {
      const allTreesToMove = [...this.props.selectedTrees, node.id];
      // Sets group of all selected + dragged trees (and the moved tree) to the new parent group
      const moveActions = allTreesToMove.map((treeId) =>
        setTreeGroupAction(
          nextParentNode.id === MISSING_GROUP_ID ? null : nextParentNode.id,
          treeId,
        ),
      );
      this.props.onBatchActions(moveActions, "SET_TREE_GROUP");
    } else {
      // A group was dragged - update the groupTree
      // Exclude root group and remove trees from groupTree object
      const newTreeGroups = removeTreesAndTransform(treeData[0].children);
      this.props.onUpdateTreeGroups(newTreeGroups);
    }
  };

  createGroup(groupId: number) {
    const newTreeGroups = _.cloneDeep(this.props.treeGroups);

    const newGroupId = getMaximumGroupId(newTreeGroups) + 1;
    const newGroup = makeBasicGroupObject(newGroupId, `Group ${newGroupId}`);

    if (groupId === MISSING_GROUP_ID) {
      newTreeGroups.push(newGroup);
    } else {
      callDeep(newTreeGroups, groupId, (item) => {
        item.children.push(newGroup);
      });
    }

    this.props.onUpdateTreeGroups(newTreeGroups);
    this.selectGroupById(newGroupId);
  }

  deleteGroup(groupId: number) {
    this.props.onDeleteGroup(groupId);
  }

  shuffleTreeGroupColors(groupId: number) {
    const groupToTreeMap = createGroupToTreesMap(this.props.trees);
    const groupIdWithSubgroups = getGroupByIdWithSubgroups(this.props.treeGroups, groupId);
    const shuffleTreeColorActions = groupIdWithSubgroups.flatMap((subGroupId) => {
      if (subGroupId in groupToTreeMap)
        return groupToTreeMap[subGroupId].map((tree) => shuffleTreeColorAction(tree.treeId));
      return [];
    });
    this.props.onBatchActions(shuffleTreeColorActions, "SHUFFLE_TREE_COLOR");
  }

  setTreeGroupColor(groupId: number, color: Vector3) {
    const groupToTreeMap = createGroupToTreesMap(this.props.trees);
    const groupIdWithSubgroups = getGroupByIdWithSubgroups(this.props.treeGroups, groupId);
    const setTreeColorActions = groupIdWithSubgroups.flatMap((subGroupId) => {
      if (subGroupId in groupToTreeMap)
        return groupToTreeMap[subGroupId].map((tree) => setTreeColorAction(tree.treeId, color));
      return [];
    });
    this.props.onBatchActions(setTreeColorActions, "SET_TREE_COLOR");
  }

  setAllTreesColor(color: Vector3) {
    const setTreeColorActions = Object.values(this.props.trees).map((tree) =>
      setTreeColorAction(tree.treeId, color),
    );
    this.props.onBatchActions(setTreeColorActions, "SET_TREE_COLOR");
  }

  handleTreeDropdownMenuVisibility = (treeId: number, isVisible: boolean) => {
    if (isVisible) {
      this.setState({
        activeTreeDropdownId: treeId,
      });
      return;
    }

    this.setState({
      activeTreeDropdownId: null,
    });
  };

  handleGroupDropdownMenuVisibility = (groupId: number, isVisible: boolean) => {
    if (isVisible) {
      this.setState({
        activeGroupDropdownId: groupId,
      });
      return;
    }

    this.setState({
      activeGroupDropdownId: null,
    });
  };

  getNodeStyleClassForBackground = (id: number) => {
    const isTreeSelected = this.props.selectedTrees.includes(id);

    if (isTreeSelected) {
      return "selected-tree-node";
    }

    return undefined;
  };

  handleMeasureSkeletonLength = (treeId: number, treeName: string) => {
    const [lengthInNm, lengthInVx] = api.tracing.measureTreeLength(treeId);
    notification.open({
      message: messages["tracing.tree_length_notification"](
        treeName,
        formatNumberInNmToLength(lengthInNm),
        formatLengthAsVx(lengthInVx),
      ),
      icon: <i className="fas fa-ruler" />,
    });
  };

  renderGroupActionsDropdown = (node: TreeNode) => {
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
    const isEditingDisabled = !this.props.allowUpdate;
    const hasSubgroup = anySatisfyDeep(node.children, (child) => child.type === TYPE_GROUP);
    const labelForActiveItems = this.getLabelForActiveItems();
    const menu: MenuProps = {
      items: [
        {
          key: "create",
          onClick: () => {
            this.createGroup(id);
            this.handleGroupDropdownMenuVisibility(id, false);
          },
          disabled: isEditingDisabled,
          icon: <PlusOutlined />,
          label: "Create new group",
        },
        labelForActiveItems != null
          ? {
              key: "moveHere",
              onClick: () => {
                this.onMoveWithContextAction(node);
                this.handleGroupDropdownMenuVisibility(id, false);
              },
              disabled: isEditingDisabled,
              icon: <ArrowRightOutlined />,
              label: `Move active ${labelForActiveItems} here`,
            }
          : null,
        {
          key: "delete",
          disabled: isEditingDisabled,
          onClick: () => this.deleteGroup(id),
          icon: <DeleteOutlined />,
          label: "Delete group",
        },
        hasSubgroup
          ? {
              key: "collapseSubgroups",
              disabled: !hasExpandedSubgroup,
              onClick: () => {
                this.setExpansionOfAllSubgroupsTo(id, false);
                this.handleGroupDropdownMenuVisibility(id, false);
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
                this.setExpansionOfAllSubgroupsTo(id, true);
                this.handleGroupDropdownMenuVisibility(id, false);
              },
              icon: <ExpandAltOutlined />,
              label: "Expand all subgroups",
            }
          : null,
        {
          key: "hideTree",
          onClick: () => {
            this.props.onSetActiveTreeGroup(id);
            this.props.onToggleHideInactiveTrees();
            this.handleGroupDropdownMenuVisibility(id, false);
          },
          icon: <i className="fas fa-eye" />,
          label: "Hide/Show all other trees",
        },
        {
          key: "shuffleTreeGroupColors",
          onClick: () => {
            if (id === MISSING_GROUP_ID) this.props.onShuffleAllTreeColors();
            else this.shuffleTreeGroupColors(id);
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
                if (id === MISSING_GROUP_ID) this.setAllTreesColor(color);
                else this.setTreeGroupColor(id, color);
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
          open={this.state.activeGroupDropdownId === id} // explicit visibility handling is required here otherwise the color picker component for "Change Tree color" is rendered/positioned incorrectly
          onOpenChange={(isVisible, info) => {
            if (info.source === "trigger") this.handleGroupDropdownMenuVisibility(id, isVisible);
          }}
          trigger={["contextMenu"]}
        >
          <span>
            {node.containsTrees ? (
              <Checkbox
                checked={node.isChecked}
                indeterminate={node.isIndeterminate}
                // @ts-expect-error ts-migrate(2322) FIXME: Type '(evt: React.MouseEvent<any>) => void' is not... Remove this comment to see the full error message
                onChange={this.onCheck}
                node={node}
                style={CHECKBOX_STYLE}
              />
            ) : (
              <span style={CHECKBOX_PLACEHOLDER_STYLE} />
            )}
            <span
              data-id={id}
              onClick={this.onSelectGroup}
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
  };

  generateNodeProps = (params: ExtendedNodeData<TreeNode>): GenerateNodePropsType => {
    // This method can be used to add props to each node of the SortableTree component
    const { node } = params;
    const nodeProps: GenerateNodePropsType = {};

    if (node.type === TYPE_GROUP) {
      nodeProps.title = this.renderGroupActionsDropdown(node);
      nodeProps.className = "group-type";
    } else {
      // @ts-expect-error ts-migrate(2345) FIXME: Argument of type 'number' is not assignable to par... Remove this comment to see the full error message
      const tree = this.props.trees[parseInt(node.id, 10)];
      const rgbColorString = tree.color.map((c) => Math.round(c * 255)).join(",");
      const isEditingDisabled = !this.props.allowUpdate;
      const isAgglomerateSkeleton = tree.type === TreeTypeEnum.AGGLOMERATE;
      // Defining background color of current node
      const styleClass = this.getNodeStyleClassForBackground(node.id);

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
                    this.props.onSetTreeColor(tree.treeId, color);
                  }}
                  rgb={tree.color}
                />
              ),
            },
            {
              key: "shuffleTreeColor",
              onClick: () => this.props.onShuffleTreeColor(tree.treeId),
              title: "Shuffle Tree Color",
              disabled: isEditingDisabled,
              icon: <i className="fas fa-adjust" />,
              label: "Shuffle Tree Color",
            },
            {
              key: "deleteTree",
              onClick: () => this.props.onDeleteTree(tree.treeId),
              title: "Delete Tree",
              disabled: isEditingDisabled,
              icon: <i className="fas fa-trash" />,
              label: "Delete Tree",
            },
            {
              key: "measureSkeleton",
              onClick: () => {
                this.handleMeasureSkeletonLength(tree.treeId, tree.name);
                this.handleTreeDropdownMenuVisibility(tree.treeId, false);
              },
              title: "Measure Tree Length",
              icon: <i className="fas fa-ruler" />,
              label: "Measure Tree Length",
            },
            {
              key: "hideTree",
              onClick: () => {
                this.props.onSetActiveTree(tree.treeId);
                this.props.onToggleHideInactiveTrees();
                this.handleTreeDropdownMenuVisibility(tree.treeId, false);
              },
              title: "Hide/Show All Other Trees",
              icon: <i className="fas fa-eye" />,
              label: "Hide/Show All Other Trees",
            },
            {
              key: "hideTreeEdges",
              onClick: () => {
                this.props.onSetActiveTree(tree.treeId);
                this.props.onSetTreeEdgesVisibility(tree.treeId, !tree.edgesAreVisible);
                this.handleTreeDropdownMenuVisibility(tree.treeId, false);
              },
              title: "Hide/Show Edges of This Tree",
              icon: <HideTreeEdgesIcon />,
              label: "Hide/Show Edges of This Tree",
            },
            isAgglomerateSkeleton
              ? {
                  key: "convertToNormalSkeleton",
                  onClick: () => {
                    this.props.onSetTreeType(tree.treeId, TreeTypeEnum.DEFAULT);
                    this.handleTreeDropdownMenuVisibility(tree.treeId, false);
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
            open={this.state.activeTreeDropdownId === tree.treeId} // explicit visibility handling is required here otherwise the color picker component for "Change Tree color" is rendered/positioned incorrectly
            onOpenChange={(isVisible, info) => {
              if (info.source === "trigger")
                this.handleTreeDropdownMenuVisibility(tree.treeId, isVisible);
            }}
            trigger={["contextMenu"]}
          >
            <span>
              <Checkbox
                checked={tree.isVisible}
                // @ts-expect-error ts-migrate(2322) FIXME: Type '(evt: React.MouseEvent<any>) => void' is not... Remove this comment to see the full error message
                onChange={this.onCheck}
                node={node}
                style={CHECKBOX_STYLE}
              />
              <div
                data-id={node.id}
                style={{
                  marginLeft: 9,
                  display: "inline",
                }}
                onClick={this.onSelectTree}
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
  };

  keySearchMethod(params: {
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

  getNodeKey({ node }: { node: TreeNode }): number {
    // The hierarchical tree contains group and tree nodes which share ids. To generate a unique
    // id number, use the [-1, ...] range for the group ids and the [..., -2] range for the tree ids.
    return node.type === TYPE_GROUP ? node.id : -1 - node.id;
  }

  canDrop = (params: OnDragPreviousAndNextLocation<TreeNode> & NodeData<TreeNode>) => {
    const { nextParent } = params;
    return this.props.allowUpdate && nextParent != null && nextParent.type === TYPE_GROUP;
  };

  canDrag = (params: ExtendedNodeData): boolean => {
    const node = params.node as TreeNode;
    return this.props.allowUpdate && node.id !== MISSING_GROUP_ID;
  };

  canNodeHaveChildren(node: TreeNode) {
    return node.type === TYPE_GROUP;
  }

  getLabelForActiveItems(): "trees" | "tree" | "group" | null {
    // Only one type of component can be selected. It is not possible to select multiple groups.
    if (this.props.selectedTrees.length > 0) {
      return "trees";
    } else if (this.props.activeTreeId != null) {
      return "tree";
    } else if (this.props.activeGroupId != null) {
      return "group";
    }
    return null;
  }

  render() {
    const { activeTreeId, activeGroupId } = this.props;
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
              treeData={this.state.groupTree}
              onChange={this.onChange}
              onMoveNode={this.onMoveNode}
              searchMethod={this.keySearchMethod}
              searchQuery={{
                activeTreeId,
                activeGroupId,
              }}
              getNodeKey={this.getNodeKey}
              generateNodeProps={this.generateNodeProps}
              canDrop={this.canDrop}
              canDrag={this.canDrag}
              canNodeHaveChildren={this.canNodeHaveChildren}
              rowHeight={24}
              innerStyle={{
                padding: 0,
              }}
              scaffoldBlockPxWidth={25}
              searchFocusOffset={this.state.searchFocusOffset}
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
  }
}

const mapDispatchToProps = (dispatch: Dispatch<any>) => ({
  onSetActiveTree(treeId: number) {
    dispatch(setActiveTreeAction(treeId));
  },

  onSetActiveTreeGroup(groupId: number) {
    dispatch(setActiveTreeGroupAction(groupId));
  },

  onSetTreeColor(treeId: number, color: Vector3) {
    dispatch(setTreeColorAction(treeId, color));
  },

  onShuffleTreeColor(treeId: number) {
    dispatch(shuffleTreeColorAction(treeId));
  },

  onDeleteTree(treeId: number) {
    dispatch(deleteTreeAction(treeId));
  },

  onToggleTree(treeId: number) {
    dispatch(toggleTreeAction(treeId));
  },

  onSetTreeEdgesVisibility(treeId: number, edgesAreVisible: boolean) {
    dispatch(setTreeEdgeVisibilityAction(treeId, edgesAreVisible));
  },

  onToggleTreeGroup(groupId: number) {
    dispatch(toggleTreeGroupAction(groupId));
  },

  onToggleAllTrees() {
    dispatch(toggleAllTreesAction());
  },

  onUpdateTreeGroups(treeGroups: TreeGroup[]) {
    dispatch(setTreeGroupsAction(treeGroups));
  },

  onBatchActions(actions: Array<Action>, actionName: string) {
    dispatch(batchActions(actions, actionName));
  },

  onToggleHideInactiveTrees() {
    dispatch(toggleInactiveTreesAction());
  },

  onShuffleAllTreeColors() {
    dispatch(shuffleAllTreeColorsAction());
  },

  onSetTreeType(treeId: number, type: TreeType) {
    dispatch(setTreeTypeAction(treeId, type));
  },
});

const connector = connect(null, mapDispatchToProps);
export default connector(TreeHierarchyView);
