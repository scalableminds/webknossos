// @flow

import { AutoSizer } from "react-virtualized";
import { Checkbox, Dropdown, Menu, Modal, notification } from "antd";
import { DeleteOutlined, PlusOutlined, SettingOutlined, ShrinkOutlined } from "@ant-design/icons";
import { connect } from "react-redux";
import { batchActions } from "redux-batched-actions";
import * as React from "react";
import { SortableTreeWithoutDndContext as SortableTree } from "react-sortable-tree";
import _ from "lodash";
import type { Dispatch } from "redux";
import { type Action } from "oxalis/model/actions/actions";
import type { Vector3 } from "oxalis/constants";
import * as Utils from "libs/utils";
import {
  MISSING_GROUP_ID,
  TYPE_GROUP,
  TYPE_TREE,
  type TreeNode,
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
} from "oxalis/model/actions/skeletontracing_actions";
import messages from "messages";
import { formatNumberToLength, formatLengthAsVx } from "libs/format_utils";
import api from "oxalis/api/internal_api";

const CHECKBOX_STYLE = {};
const CHECKBOX_PLACEHOLDER_STYLE = { width: 16, display: "inline-block" };

type OwnProps = {|
  activeTreeId: ?number,
  activeGroupId: ?number,
  treeGroups: Array<TreeGroup>,
  // eslint-disable-next-line react/no-unused-prop-types
  sortBy: string,
  trees: TreeMap,
  selectedTrees: Array<number>,
  onSelectTree: number => void,
  deselectAllTrees: () => void,
  onDeleteGroup: number => void,
  allowUpdate: boolean,
|};

type Props = {
  ...OwnProps,
  onShuffleTreeColor: number => void,
  onSetActiveTree: number => void,
  onSetActiveGroup: number => void,
  onToggleTree: number => void,
  onToggleAllTrees: () => void,
  onSetTreeColor: (number, Vector3) => void,
  onToggleTreeGroup: number => void,
  onUpdateTreeGroups: (Array<TreeGroup>) => void,
  onBatchActions: (Array<Action>, string) => void,
};

type State = {
  prevProps: ?Props,
  expandedGroupIds: { [number]: boolean },
  groupTree: Array<TreeNode>,
  searchFocusOffset: number,
  activeTreeDropdownId: ?number,
};

const didTreeDataChange = (prevProps: Props, nextProps: Props): boolean =>
  prevProps.trees !== nextProps.trees ||
  prevProps.treeGroups !== nextProps.treeGroups ||
  prevProps.sortBy !== nextProps.sortBy;

class TreeHierarchyView extends React.PureComponent<Props, State> {
  state = {
    expandedGroupIds: { [MISSING_GROUP_ID]: true },
    groupTree: [],
    prevProps: null,
    searchFocusOffset: 0,
    activeTreeDropdownId: null,
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
      // eslint-disable-next-line react/no-did-update-set-state
      await this.setState({ searchFocusOffset: 1 });
      // eslint-disable-next-line react/no-did-update-set-state
      this.setState({ searchFocusOffset: 0 });
    }
  }

  onChange = (treeData: Array<TreeNode>) => {
    const expandedGroupIds = {};
    forEachTreeNode(treeData, node => {
      if (node.type === TYPE_GROUP && node.expanded) expandedGroupIds[node.id] = true;
    });
    this.setState({ groupTree: treeData, expandedGroupIds });
  };

  onCheck = (evt: SyntheticMouseEvent<*>) => {
    // $FlowIssue[prop-missing] .node is unknown to flow
    const { id, type } = evt.target.node;
    if (type === TYPE_TREE) {
      this.props.onToggleTree(parseInt(id, 10));
    } else if (id === MISSING_GROUP_ID) {
      this.props.onToggleAllTrees();
    } else {
      this.props.onToggleTreeGroup(id);
    }
  };

  onSelectTree = (evt: SyntheticMouseEvent<*>) => {
    // $FlowIssue[prop-missing] .dataset is unknown to flow
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

  onSelectGroup = (evt: SyntheticMouseEvent<*>) => {
    // $FlowIssue[prop-missing] .dataset is unknown to flow
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
    const collapseAllGroups = groupTree => {
      const copyOfGroupTree = _.cloneDeep(groupTree);
      findTreeNode(copyOfGroupTree, groupId, item => {
        // If we expand all subgroups, the group itself should be expanded.
        if (expanded) {
          item.expanded = expanded;
        }
        forEachTreeNode(item.children, node => {
          if (node.type === TYPE_GROUP) {
            node.expanded = expanded;
            newExpandedGroupIds[node.id] = expanded;
          }
        });
      });
      return copyOfGroupTree;
    };
    this.setState(prevState => ({
      groupTree: collapseAllGroups(prevState.groupTree),
      expandedGroupIds: newExpandedGroupIds,
    }));
  };

  onMoveNode = (params: {
    nextParentNode: TreeNode,
    node: TreeNode,
    treeData: Array<TreeNode>,
  }) => {
    const { nextParentNode, node, treeData } = params;
    if (node.type === TYPE_TREE) {
      const allTreesToMove = [...this.props.selectedTrees, node.id];
      // Sets group of all selected + dragged trees (and the moved tree) to the new parent group
      const moveActions = allTreesToMove.map(treeId =>
        setTreeGroupAction(
          nextParentNode.id === MISSING_GROUP_ID ? null : nextParentNode.id,
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
      callDeep(newTreeGroups, groupId, item => {
        item.children.push(newGroup);
      });
    }
    this.props.onUpdateTreeGroups(newTreeGroups);
    this.selectGroupById(newGroupId);
  }

  deleteGroup(groupId: number) {
    this.props.onDeleteGroup(groupId);
  }

  handleDropdownClick = (params: { domEvent: SyntheticMouseEvent<*>, key: string }) => {
    const { domEvent, key } = params;
    // $FlowIssue[prop-missing] .dataset is unknown to flow
    const groupId = parseInt(domEvent.target.dataset.groupId, 10);
    if (key === "create") {
      this.createGroup(groupId);
    } else if (key === "delete") {
      this.deleteGroup(groupId);
    } else if (key === "collapseSubgroups") {
      this.setExpansionOfAllSubgroupsTo(groupId, false);
    } else if (key === "expandSubgroups") {
      this.setExpansionOfAllSubgroupsTo(groupId, true);
    }
  };

  handleTreeDropdownMenuVisibility = (treeId: number, isVisible: boolean) => {
    if (isVisible) {
      this.setState({ activeTreeDropdownId: treeId });
      return;
    }
    this.setState({ activeTreeDropdownId: null });
  };

  toggleTreeDropdownMenuVisibility = (treeId: number) => {
    if (this.state.activeTreeDropdownId === treeId) {
      this.setState({ activeTreeDropdownId: null });
    } else {
      this.setState({ activeTreeDropdownId: treeId });
    }
  };

  getNodeStyleClassForBackground = (id: number) => {
    const isTreeSelected = this.props.selectedTrees.includes(id);
    if (isTreeSelected) {
      return "selected-tree-node";
    }
    return null;
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
    const isRoot = id === MISSING_GROUP_ID;
    const hasExpandedSubgroup = anySatisfyDeep(
      node.children,
      child => child.expanded && child.type === TYPE_GROUP,
    );
    const hasCollapsedSubgroup = anySatisfyDeep(
      node.children,
      child => !child.expanded && child.type === TYPE_GROUP,
    );
    const hasSubgroup = anySatisfyDeep(node.children, child => child.type === TYPE_GROUP);
    const menu = (
      <Menu onClick={this.handleDropdownClick}>
        <Menu.Item key="create" data-group-id={id}>
          <PlusOutlined />
          Create new group
        </Menu.Item>
        <Menu.Item key="delete" data-group-id={id} disabled={isRoot}>
          <DeleteOutlined />
          Delete
        </Menu.Item>
        {hasSubgroup ? (
          <Menu.Item key="collapseSubgroups" data-group-id={id} disabled={!hasExpandedSubgroup}>
            <ShrinkOutlined />
            Collapse all subgroups
          </Menu.Item>
        ) : null}
        {hasSubgroup ? (
          <Menu.Item key="expandSubgroups" data-group-id={id} disabled={!hasCollapsedSubgroup}>
            <ShrinkOutlined />
            Expand all subgroups
          </Menu.Item>
        ) : null}
      </Menu>
    );

    // Make sure the displayed name is not empty
    const displayableName = name.trim() || "<no name>";
    const nameAndDropdown = (
      <span className="ant-dropdown-link">
        <span data-id={id} onClick={this.onSelectGroup} style={{ marginLeft: 9 }}>
          {displayableName}{" "}
        </span>
        <Dropdown overlay={menu} placement="bottomCenter">
          <SettingOutlined className="group-actions-icon" />
        </Dropdown>
      </span>
    );
    return (
      <div>
        {node.containsTrees ? (
          <Checkbox
            checked={node.isChecked}
            indeterminate={node.isIndeterminate}
            onChange={this.onCheck}
            node={node}
            style={CHECKBOX_STYLE}
          />
        ) : (
          <span style={CHECKBOX_PLACEHOLDER_STYLE} />
        )}
        {nameAndDropdown}
      </div>
    );
  };

  generateNodeProps = (params: { node: TreeNode }) => {
    // This method can be used to add props to each node of the SortableTree component
    const { node } = params;
    const nodeProps = {};
    if (node.type === TYPE_GROUP) {
      nodeProps.title = this.renderGroupActionsDropdown(node);
      nodeProps.className = "group-type";
    } else {
      const tree = this.props.trees[parseInt(node.id, 10)];
      const rgbColorString = tree.color.map(c => Math.round(c * 255)).join(",");
      // Defining background color of current node
      const styleClass = this.getNodeStyleClassForBackground(node.id);
      const createMenu = () => (
        <Menu>
          <Menu.Item key="changeTreeColor">
            <div style={{ position: "relative", display: "inline-block", width: "100%" }}>
              <i
                className="fas fa-eye-dropper fa-sm"
                style={{
                  cursor: "pointer",
                }}
              />{" "}
              Select Tree Color
              <input
                type="color"
                value={Utils.rgbToHex(Utils.map3(value => value * 255, tree.color))}
                style={{
                  position: "absolute",
                  left: 0,
                  top: 0,
                  width: "100%",
                  opacity: 0,
                  cursor: "pointer",
                }}
                onChange={event => {
                  let color = Utils.hexToRgb(event.target.value);
                  color = Utils.map3(component => component / 255, color);
                  this.props.onSetTreeColor(tree.treeId, color);
                }}
              />
            </div>
          </Menu.Item>
          <Menu.Item
            key="shuffleTreeColor"
            onClick={() => this.props.onShuffleTreeColor(tree.treeId)}
            title="Shuffle Tree Color"
          >
            <i className="fas fa-adjust" /> Shuffle Tree Color
          </Menu.Item>
          <Menu.Item
            key="measureSkeleton"
            onClick={() => this.handleMeasureSkeletonLength(tree.treeId, tree.name)}
            title="Measure Skeleton Length"
          >
            <i className="fas fa-ruler" /> Measure Skeleton Length
          </Menu.Item>
        </Menu>
      );

      nodeProps.title = (
        <div className={styleClass}>
          <Dropdown
            overlay={createMenu}
            // The overlay is generated lazily. By default, this would make the overlay
            // re-render on each parent's render() after it was shown for the first time.
            // The reason for this is that it's not destroyed after closing.
            // Therefore, autoDestroy is passed.
            // destroyPopupOnHide should also be an option according to the docs, but
            // does not work properly. See https://github.com/react-component/trigger/issues/106#issuecomment-948532990
            autoDestroy
            placement="bottomCenter"
            visible={this.state.activeTreeDropdownId === tree.treeId}
            onVisibleChange={isVisible =>
              this.handleTreeDropdownMenuVisibility(tree.treeId, isVisible)
            }
            trigger={["contextMenu"]}
          >
            <span>
              <Checkbox
                checked={tree.isVisible}
                onChange={this.onCheck}
                node={node}
                style={CHECKBOX_STYLE}
              />
              <div
                data-id={node.id}
                style={{ marginLeft: 9, display: "inline" }}
                onClick={this.onSelectTree}
              >{`(${tree.nodes.size()}) ${tree.name}`}</div>
            </span>
          </Dropdown>
        </div>
      );
      nodeProps.className = "tree-type";
      nodeProps.style = { color: `rgb(${rgbColorString})` };
    }
    return nodeProps;
  };

  keySearchMethod(params: {
    node: TreeNode,
    searchQuery: { activeTreeId: number, activeGroupId: number },
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

  canDrop = (params: { nextParent: TreeNode }) => {
    const { nextParent } = params;
    return this.props.allowUpdate && nextParent != null && nextParent.type === TYPE_GROUP;
  };

  canDrag = (params: { node: TreeNode }) => {
    const { node } = params;
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
          <div style={{ height, width }}>
            <SortableTree
              treeData={this.state.groupTree}
              onChange={this.onChange}
              onMoveNode={this.onMoveNode}
              searchMethod={this.keySearchMethod}
              searchQuery={{ activeTreeId, activeGroupId }}
              getNodeKey={this.getNodeKey}
              generateNodeProps={this.generateNodeProps}
              canDrop={this.canDrop}
              canDrag={this.canDrag}
              canNodeHaveChildren={this.canNodeHaveChildren}
              rowHeight={24}
              innerStyle={{ padding: 0 }}
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

const mapDispatchToProps = (dispatch: Dispatch<*>) => ({
  onSetActiveTree(treeId) {
    dispatch(setActiveTreeAction(treeId));
  },
  onSetActiveGroup(groupId) {
    dispatch(setActiveGroupAction(groupId));
  },
  onSetTreeColor(treeId, color) {
    dispatch(setTreeColorAction(treeId, color));
  },
  onShuffleTreeColor(treeId) {
    dispatch(shuffleTreeColorAction(treeId));
  },
  onToggleTree(treeId) {
    dispatch(toggleTreeAction(treeId));
  },
  onToggleTreeGroup(groupId) {
    dispatch(toggleTreeGroupAction(groupId));
  },
  onToggleAllTrees() {
    dispatch(toggleAllTreesAction());
  },
  onUpdateTreeGroups(treeGroups) {
    dispatch(setTreeGroupsAction(treeGroups));
  },
  onBatchActions(actions, actionName) {
    dispatch(batchActions(actions, actionName));
  },
});

export default connect<Props, OwnProps, _, _, _, _>(
  null,
  mapDispatchToProps,
)(TreeHierarchyView);
