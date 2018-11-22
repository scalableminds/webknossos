// @flow

import { AutoSizer } from "react-virtualized";
import { Dropdown, Menu, Icon, Checkbox } from "antd";
import { connect } from "react-redux";
import * as React from "react";
import SortableTree from "react-sortable-tree";
import _ from "lodash";
import update from "immutability-helper";

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
} from "oxalis/view/right-menu/tree_hierarchy_view_helpers";
import type { TreeMap, TreeGroup } from "oxalis/store";
import { getMaximumGroupId } from "oxalis/model/reducers/skeletontracing_reducer_helpers";
import {
  setActiveTreeAction,
  setActiveGroupAction,
  toggleTreeAction,
  toggleTreeGroupAction,
  toggleAllTreesAction,
  setTreeGroupsAction,
  setTreeGroupAction,
} from "oxalis/model/actions/skeletontracing_actions";

const CHECKBOX_STYLE = { verticalAlign: "middle" };

type Props = {
  activeTreeId: number,
  activeGroupId: number,
  treeGroups: Array<TreeGroup>,
  // TODO: eslint doesn't recognize, that sortBy is indeed used in the getDerivedStateFromProps function
  // eslint-disable-next-line react/no-unused-prop-types
  sortBy: string,
  trees: TreeMap,
  onSetActiveTree: number => void,
  onSetActiveGroup: number => void,
  onToggleTree: number => void,
  onToggleAllTrees: () => void,
  onToggleTreeGroup: number => void,
  onUpdateTreeGroups: (Array<TreeGroup>) => void,
  onSetTreeGroup: (?number, number) => void,
};

type State = {
  prevProps: ?Props,
  expandedGroupIds: { [number]: boolean },
  groupTree: Array<TreeNode>,
  searchFocusOffset: number,
};

class TreeHierarchyView extends React.PureComponent<Props, State> {
  state = {
    expandedGroupIds: {},
    groupTree: [],
    prevProps: null,
    searchFocusOffset: 0,
  };

  static getDerivedStateFromProps(nextProps: Props, prevState: State) {
    if (
      prevState.prevProps == null ||
      prevState.prevProps.trees !== nextProps.trees ||
      prevState.prevProps.treeGroups !== nextProps.treeGroups ||
      prevState.prevProps.sortBy !== nextProps.sortBy
    ) {
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

  async componentDidUpdate(prevProps) {
    // TODO: Workaround, remove after https://github.com/frontend-collective/react-sortable-tree/issues/305 is fixed
    // Also remove the searchFocusOffset from the state and hard-code it as 0
    if (
      prevProps.trees !== this.props.trees &&
      prevProps.activeTreeId !== this.props.activeTreeId
    ) {
      // eslint-disable-next-line react/no-did-update-set-state
      await this.setState({ searchFocusOffset: 1 });
      // eslint-disable-next-line react/no-did-update-set-state
      this.setState({ searchFocusOffset: 0 });
    }
  }

  onChange = (treeData: Array<TreeNode>) => {
    this.setState({ groupTree: treeData });
  };

  onCheck = evt => {
    const { id, type } = evt.target.node;
    if (type === TYPE_TREE) {
      this.props.onToggleTree(parseInt(id, 10));
    } else if (id === MISSING_GROUP_ID) {
      this.props.onToggleAllTrees();
    } else {
      this.props.onToggleTreeGroup(id);
    }
  };

  onSelectTree = evt => {
    const treeId = evt.target.dataset.id;
    this.props.onSetActiveTree(parseInt(treeId, 10));
  };

  onSelectGroup = evt => {
    const groupId = evt.target.dataset.id;
    this.props.onSetActiveGroup(parseInt(groupId, 10));
  };

  onExpand = (params: { node: TreeNode, expanded: boolean }) => {
    // Cannot use object destructuring in the parameters here, because the linter will complain
    // about the Flow types
    const { node, expanded } = params;
    this.setState(prevState => ({
      expandedGroupIds: update(prevState.expandedGroupIds, { [node.id]: { $set: expanded } }),
    }));
  };

  onMoveNode = (params: {
    nextParentNode: TreeNode,
    node: TreeNode,
    treeData: Array<TreeNode>,
  }) => {
    const { nextParentNode, node, treeData } = params;
    if (node.type === TYPE_TREE) {
      // A tree was dragged - update the group of the dragged tree
      this.props.onSetTreeGroup(
        nextParentNode.id === MISSING_GROUP_ID ? null : nextParentNode.id,
        parseInt(node.id, 10),
      );
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
  }

  deleteGroup(groupId: number) {
    const newTreeGroups = _.cloneDeep(this.props.treeGroups);
    const groupToTreesMap = createGroupToTreesMap(this.props.trees);
    callDeep(newTreeGroups, groupId, (item, index, arr, parentGroupId) => {
      // Remove group and move its group children to the parent group
      arr.splice(index, 1);
      arr.push(...item.children);
      // Update the group of all its tree children to the parent group
      const trees = groupToTreesMap[groupId] != null ? groupToTreesMap[groupId] : [];
      for (const tree of trees) {
        this.props.onSetTreeGroup(
          parentGroupId === MISSING_GROUP_ID ? null : parentGroupId,
          tree.treeId,
        );
      }
    });
    this.props.onUpdateTreeGroups(newTreeGroups);
  }

  handleDropdownClick = (params: { item: *, key: string }) => {
    const { item, key } = params;
    const { groupId } = item.props;
    if (key === "create") {
      this.createGroup(groupId);
    } else if (key === "delete") {
      this.deleteGroup(groupId);
    }
  };

  renderGroupActionsDropdown = (node: TreeNode) => {
    // The root group must not be removed or renamed
    const { id, name } = node;
    const isRoot = id === MISSING_GROUP_ID;
    const menu = (
      <Menu onClick={this.handleDropdownClick}>
        <Menu.Item key="create" groupId={id}>
          <Icon type="plus" />Create new group
        </Menu.Item>
        <Menu.Item key="delete" groupId={id} disabled={isRoot}>
          <Icon type="delete" />Delete
        </Menu.Item>
      </Menu>
    );

    // Make sure the displayed name is not empty
    const displayableName = name.trim() || "<no name>";

    const nameAndDropdown = (
      <span className="ant-dropdown-link">
        <span data-id={id} onClick={this.onSelectGroup}>
          {displayableName}{" "}
        </span>
        <Dropdown overlay={menu} placement="bottomCenter">
          <Icon type="setting" className="group-actions-icon" />
        </Dropdown>
      </span>
    );

    return (
      <div>
        <Checkbox
          checked={node.isChecked}
          onChange={this.onCheck}
          node={node}
          style={CHECKBOX_STYLE}
        />{" "}
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
      nodeProps.title = (
        <div data-id={node.id} onClick={this.onSelectTree}>
          <Checkbox
            checked={tree.isVisible}
            onChange={this.onCheck}
            node={node}
            style={CHECKBOX_STYLE}
          />
          {` (${tree.nodes.size()}) ${tree.name}`}
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

  canDrop(params: { nextParent: TreeNode }) {
    const { nextParent } = params;
    return nextParent != null && nextParent.type === TYPE_GROUP;
  }

  canDrag(params: { node: TreeNode }) {
    const { node } = params;
    return node.id !== MISSING_GROUP_ID;
  }

  render() {
    const { activeTreeId, activeGroupId } = this.props;
    return (
      <AutoSizer className="info-tab-content">
        {({ height, width }) => (
          <div style={{ height, width }}>
            {
              // this.renderCreateGroupModal()
            }
            <SortableTree
              treeData={this.state.groupTree}
              onChange={this.onChange}
              onMoveNode={this.onMoveNode}
              onVisibilityToggle={this.onExpand}
              searchMethod={this.keySearchMethod}
              searchQuery={{ activeTreeId, activeGroupId }}
              generateNodeProps={this.generateNodeProps}
              canDrop={this.canDrop}
              canDrag={this.canDrag}
              rowHeight={24}
              innerStyle={{ padding: 0 }}
              scaffoldBlockPxWidth={25}
              searchFocusOffset={this.state.searchFocusOffset}
              reactVirtualizedListProps={{ scrollToAlignment: "auto", tabIndex: null }}
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
  onSetTreeGroup(groupId, treeId) {
    dispatch(setTreeGroupAction(groupId, treeId));
  },
});

export default connect(
  null,
  mapDispatchToProps,
)(TreeHierarchyView);
