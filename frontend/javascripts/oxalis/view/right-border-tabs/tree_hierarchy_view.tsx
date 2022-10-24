import { AutoSizer } from "react-virtualized";
import { Checkbox, Dropdown, Menu, Modal, notification } from "antd";
import { DeleteOutlined, PlusOutlined, ShrinkOutlined } from "@ant-design/icons";
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
import type { Vector3 } from "oxalis/constants";

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
  setActiveGroupAction,
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
} from "oxalis/model/actions/skeletontracing_actions";
import messages from "messages";
import { formatNumberToLength, formatLengthAsVx } from "libs/format_utils";
import api from "oxalis/api/internal_api";
import { ChangeColorMenuItemContent } from "components/color_picker";

const CHECKBOX_STYLE = {};
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
  onSetActiveGroup: (arg0: number) => void;
  onToggleTree: (arg0: number) => void;
  onDeleteTree: (arg0: number) => void;
  onToggleAllTrees: () => void;
  onSetTreeColor: (arg0: number, arg1: Vector3) => void;
  onToggleTreeGroup: (arg0: number) => void;
  onUpdateTreeGroups: (arg0: Array<TreeGroup>) => void;
  onBatchActions: (arg0: Array<Action>, arg1: string) => void;
  onToggleHideInactiveTrees: () => void;
  onShuffleAllTreeColors: () => void;
};
type State = {
  prevProps: Props | null | undefined;
  expandedGroupIds: Record<number, boolean>;
  groupTree: Array<TreeNode>;
  searchFocusOffset: number;
  activeTreeDropdownId: number | null | undefined;
  activeGroupDropdownId: number | null | undefined;
};

type GenerateNodePropsType = { title?: JSX.Element; className?: string; style?: React.CSSProperties };

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
      await this.setState({
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
    // @ts-expect-error ts-migrate(2339) FIXME: Property 'dataset' does not exist on type 'EventTa... Remove this comment to see the full error message
    const treeId = parseInt(evt.target.dataset.id, 10);

    if (evt.ctrlKey || evt.metaKey) {
      this.props.onSelectTree(treeId);
    } else {
      this.props.deselectAllTrees();
      this.props.onSetActiveTree(treeId);
    }
  };

  selectGroupById = (groupId: number) => {
    this.props.deselectAllTrees();
    this.props.onSetActiveGroup(groupId);
  };

  onSelectGroup = (evt: React.MouseEvent<any>) => {
    // @ts-expect-error ts-migrate(2339) FIXME: Property 'dataset' does not exist on type 'EventTa... Remove this comment to see the full error message
    const groupId = parseInt(evt.target.dataset.id, 10);
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
          // @ts-expect-error ts-migrate(2345) FIXME: Argument of type 'number' is not assignable to par... Remove this comment to see the full error message
          parseInt(treeId, 10),
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
    const shuffleTreeColorActions = groupIdWithSubgroups.flatMap((subGroupId) => {
      if (subGroupId in groupToTreeMap)
        return groupToTreeMap[subGroupId].map((tree) => setTreeColorAction(tree.treeId, color));
      return [];
    });
    this.props.onBatchActions(shuffleTreeColorActions, "SET_TREE_COLOR");
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
        formatNumberToLength(lengthInNm),
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
    const createMenu = () => (
      <Menu>
        <Menu.Item
          key="create"
          data-group-id={id}
          onClick={() => this.createGroup(id)}
          disabled={isEditingDisabled}
        >
          <PlusOutlined />
          Create new group
        </Menu.Item>
        <Menu.Item
          key="delete"
          data-group-id={id}
          disabled={isEditingDisabled}
          onClick={() => this.deleteGroup(id)}
        >
          <DeleteOutlined />
          Delete group
        </Menu.Item>
        {hasSubgroup ? (
          <Menu.Item
            key="collapseSubgroups"
            data-group-id={id}
            disabled={!hasExpandedSubgroup}
            onClick={() => this.setExpansionOfAllSubgroupsTo(id, false)}
          >
            <ShrinkOutlined />
            Collapse all subgroups
          </Menu.Item>
        ) : null}
        {hasSubgroup ? (
          <Menu.Item
            key="expandSubgroups"
            data-group-id={id}
            disabled={!hasCollapsedSubgroup}
            onClick={() => this.setExpansionOfAllSubgroupsTo(id, true)}
          >
            <ShrinkOutlined />
            Expand all subgroups
          </Menu.Item>
        ) : null}
        <Menu.Item
          key="hideTree"
          onClick={() => {
            this.props.onSetActiveGroup(id);
            this.props.onToggleHideInactiveTrees();
          }}
          title="Hide/Show all other trees"
        >
          <i className="fas fa-eye" /> Hide/Show all other trees
        </Menu.Item>
        <Menu.Item
          key="shuffleTreeGroupColors"
          onClick={() => {
            if (id === MISSING_GROUP_ID) this.props.onShuffleAllTreeColors();
            else this.shuffleTreeGroupColors(id);
          }}
          title="Shuffle Tree Colors"
        >
          <i className="fas fa-adjust" /> Shuffle Tree Group Colors
        </Menu.Item>
        {id !== MISSING_GROUP_ID ? (
          <Menu.Item key="setTreeGroupColor" disabled={isEditingDisabled}>
            <ChangeColorMenuItemContent
              title="Change Tree Group Color"
              isDisabled={false}
              onSetColor={(color) => {
                this.setTreeGroupColor(id, color);
              }}
              rgb={[0.5, 0.5, 0.5]}
            />
          </Menu.Item>
        ) : null}
      </Menu>
    );

    // Make sure the displayed name is not empty
    const displayableName = name.trim() || "<no name>";
    return (
      <div>
        <Dropdown
          overlay={createMenu}
          placement="bottom" // The overlay is generated lazily. By default, this would make the overlay
          // re-render on each parent's render() after it was shown for the first time.
          // The reason for this is that it's not destroyed after closing.
          // Therefore, autoDestroy is passed.
          // destroyPopupOnHide should also be an option according to the docs, but
          // does not work properly. See https://github.com/react-component/trigger/issues/106#issuecomment-948532990
          // @ts-expect-error ts-migrate(2322) FIXME: Type '{ children: Element; overlay: () => Element;... Remove this comment to see the full error message
          autoDestroy
          visible={this.state.activeGroupDropdownId === id} // explicit visibility handling is required here otherwise the color picker component for "Change Tree color" is rendered/positioned incorrectly
          onVisibleChange={(isVisible) => this.handleGroupDropdownMenuVisibility(id, isVisible)}
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
      // Defining background color of current node
      const styleClass = this.getNodeStyleClassForBackground(node.id);

      const createMenu = () => (
        <Menu>
          <Menu.Item key="changeTreeColor" disabled={isEditingDisabled}>
            <ChangeColorMenuItemContent
              title="Change Tree Color"
              isDisabled={isEditingDisabled}
              onSetColor={(color) => {
                this.props.onSetTreeColor(tree.treeId, color);
              }}
              rgb={tree.color}
            />
          </Menu.Item>
          <Menu.Item
            key="shuffleTreeColor"
            onClick={() => this.props.onShuffleTreeColor(tree.treeId)}
            title="Shuffle Tree Color"
            disabled={isEditingDisabled}
          >
            <i className="fas fa-adjust" /> Shuffle Tree Color
          </Menu.Item>
          <Menu.Item
            key="deleteTree"
            onClick={() => this.props.onDeleteTree(tree.treeId)}
            title="Delete Tree"
            disabled={isEditingDisabled}
          >
            <i className="fas fa-trash" /> Delete Tree
          </Menu.Item>
          <Menu.Item
            key="measureSkeleton"
            onClick={() => this.handleMeasureSkeletonLength(tree.treeId, tree.name)}
            title="Measure Skeleton Length"
          >
            <i className="fas fa-ruler" /> Measure Skeleton Length
          </Menu.Item>
          <Menu.Item
            key="hideTree"
            onClick={() => {
              this.props.onSetActiveTree(tree.treeId);
              this.props.onToggleHideInactiveTrees();
              this.handleTreeDropdownMenuVisibility(tree.treeId, false);
            }}
            title="Hide/Show all other trees"
          >
            <i className="fas fa-eye" /> Hide/Show all other trees
          </Menu.Item>
        </Menu>
      );

      nodeProps.title = (
        <div className={styleClass}>
          <Dropdown
            overlay={createMenu} // The overlay is generated lazily. By default, this would make the overlay
            // re-render on each parent's render() after it was shown for the first time.
            // The reason for this is that it's not destroyed after closing.
            // Therefore, autoDestroy is passed.
            // destroyPopupOnHide should also be an option according to the docs, but
            // does not work properly. See https://github.com/react-component/trigger/issues/106#issuecomment-948532990
            // @ts-expect-error ts-migrate(2322) FIXME: Type '{ children: Element; overlay: () => Element;... Remove this comment to see the full error message
            autoDestroy
            placement="bottom"
            visible={this.state.activeTreeDropdownId === tree.treeId} // explicit visibility handling is required here otherwise the color picker component for "Change Tree color" is rendered/positioned incorrectly
            onVisibleChange={(isVisible) =>
              this.handleTreeDropdownMenuVisibility(tree.treeId, isVisible)
            }
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
              >{`(${tree.nodes.size()}) ${tree.name}`}</div>
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

  onSetActiveGroup(groupId: number) {
    dispatch(setActiveGroupAction(groupId));
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
});

const connector = connect(null, mapDispatchToProps);
export default connector(TreeHierarchyView);
