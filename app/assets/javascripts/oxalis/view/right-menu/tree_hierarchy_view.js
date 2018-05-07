// @flow

import _ from "lodash";
import * as React from "react";
import { connect } from "react-redux";
import update from "immutability-helper";
import { Modal, Dropdown, Menu, Icon, Input, Checkbox } from "antd";
import {
  setActiveTreeAction,
  toggleTreeAction,
  toggleTreeGroupAction,
  toggleAllTreesAction,
  setTreeGroupsAction,
  setTreeGroupAction,
} from "oxalis/model/actions/skeletontracing_actions";
import Utils from "libs/utils";
import SortableTree from "react-sortable-tree";
import { AutoSizer } from "react-virtualized";
import type { TreeType, TreeMapType, TreeGroupType, TreeGroupBaseType } from "oxalis/store";

const MISSING_GROUP_ID = "__none__";

const TYPE_GROUP = "GROUP";
const TYPE_TREE = "TREE";
const GroupTypeEnum = {
  [TYPE_GROUP]: TYPE_GROUP,
  [TYPE_TREE]: TYPE_TREE,
};
type TreeOrGroupType = $Keys<typeof GroupTypeEnum>;

type ExtendedTreeGroupType = TreeGroupBaseType & {
  expanded: boolean,
  isChecked: boolean,
  timestamp: number,
  type: TreeOrGroupType,
  children: Array<ExtendedTreeGroupType>,
};

type Props = {
  activeTreeId: number,
  treeGroups: Array<TreeGroupType>,
  // TODO: Remove once https://github.com/yannickcr/eslint-plugin-react/issues/1751 is merged
  // eslint-disable-next-line react/no-unused-prop-types
  sortBy: string,
  trees: TreeMapType,
  onSetActiveTree: number => void,
  onToggleTree: number => void,
  onToggleAllTrees: () => void,
  onToggleTreeGroup: string => void,
  onUpdateTreeGroups: (Array<TreeGroupType>) => void,
  onSetTreeGroup: (?string, number) => void,
};

type State = {
  prevProps: ?Props,
  hoveredGroupId: ?string,
  expandedGroupIds: { [string]: boolean },
  groupTree: Array<ExtendedTreeGroupType>,
  renamingGroup: ?{ groupId: string, name: string },
};

function makeBasicGroupObject(
  groupId: string,
  name: string,
  children: Array<TreeGroupType> = [],
): TreeGroupType {
  return {
    groupId,
    name,
    children,
  };
}

function makeExtendedGroupObject(
  groupId: string | number,
  name: string,
  type: TreeOrGroupType,
  timestamp?: number = 0,
  isChecked?: boolean = false,
): ExtendedTreeGroupType {
  return {
    groupId: `${groupId}`,
    type,
    name,
    timestamp,
    isChecked,
    children: [],
    expanded: true,
  };
}

function makeExtendedGroupObjectFromTree(tree: TreeType): ExtendedTreeGroupType {
  return makeExtendedGroupObject(tree.treeId, tree.name, TYPE_TREE, tree.timestamp, tree.isVisible);
}

function makeExtendedGroupObjectFromGroup(group: TreeGroupType): ExtendedTreeGroupType {
  return makeExtendedGroupObject(group.groupId, group.name, TYPE_GROUP);
}

function removeTreesAndTransform(groupTree: Array<ExtendedTreeGroupType>): Array<TreeGroupType> {
  return _.filter(groupTree, group => {
    if (group.type === TYPE_GROUP) {
      return true;
    }
    return false;
  }).map(group =>
    makeBasicGroupObject(group.groupId, group.name, removeTreesAndTransform(group.children)),
  );
}

function insertTreesAndTransform(
  groups: Array<TreeGroupType>,
  groupToTreesMap: { [string]: Array<TreeType> },
  expandedGroupIds: { [string]: boolean },
  sortBy: string,
): Array<ExtendedTreeGroupType> {
  return groups.map(group => {
    const { groupId } = group;
    const transformedGroup = makeExtendedGroupObjectFromGroup(group);
    // Ensure that groups are always at the top when sorting by timestamp
    transformedGroup.timestamp = 0;
    transformedGroup.expanded =
      expandedGroupIds[groupId] != null ? expandedGroupIds[groupId] : true;
    expandedGroupIds[groupId] = transformedGroup.expanded;
    transformedGroup.children = insertTreesAndTransform(
      group.children,
      groupToTreesMap,
      expandedGroupIds,
      sortBy,
    );
    if (groupToTreesMap[groupId] != null) {
      // Groups are always sorted by name and appear before the trees, trees are sorted according to the sortBy prop
      transformedGroup.children = _.orderBy(transformedGroup.children, ["name"], ["asc"]).concat(
        _.orderBy(groupToTreesMap[groupId], [sortBy], ["asc"]).map(makeExtendedGroupObjectFromTree),
      );
    }
    transformedGroup.isChecked = _.every(
      transformedGroup.children,
      groupOrTree => groupOrTree.isChecked,
    );
    return transformedGroup;
  });
}

function callDeep(
  groups: Array<TreeGroupType>,
  groupId: string,
  callback: (TreeGroupType, number, Array<TreeGroupType>, ?string) => void,
  parentGroupId: ?string = MISSING_GROUP_ID,
) {
  groups.forEach((group: TreeGroupType, index: number, array: Array<TreeGroupType>) => {
    if (group.groupId === groupId) {
      callback(group, index, array, parentGroupId);
    }
    if (group.children) {
      callDeep(group.children, groupId, callback, group.groupId);
    }
  });
}

function createGroupToTreesMap(trees: TreeMapType): { [string]: Array<TreeType> } {
  return _.groupBy(trees, tree => (tree.groupId != null ? tree.groupId : MISSING_GROUP_ID));
}

class TreeHierarchyView extends React.PureComponent<Props, State> {
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

  state = {
    hoveredGroupId: null,
    expandedGroupIds: {},
    groupTree: [],
    renamingGroup: null,
    // TODO: Remove once https://github.com/yannickcr/eslint-plugin-react/issues/1751 is merged
    // eslint-disable-next-line react/no-unused-state
    prevProps: null,
  };

  onChange = treeData => {
    this.setState({ groupTree: treeData });
  };

  onCheck = evt => {
    const { groupId, type } = evt.target.node;
    if (type === TYPE_TREE) {
      this.props.onToggleTree(parseInt(groupId, 10));
    } else if (groupId === MISSING_GROUP_ID) {
      this.props.onToggleAllTrees();
    } else {
      this.props.onToggleTreeGroup(groupId);
    }
  };

  onSelect = evt => {
    const treeId = evt.target.dataset.groupid;
    this.props.onSetActiveTree(parseInt(treeId, 10));
  };

  onExpand = ({ node, expanded }) => {
    this.setState({
      expandedGroupIds: update(this.state.expandedGroupIds, { [node.groupId]: { $set: expanded } }),
    });
  };

  onMoveNode = ({ nextParentNode, node, treeData }) => {
    if (node.type === TYPE_TREE && nextParentNode.groupId) {
      // A tree was dragged - update the group of the dragged tree
      this.props.onSetTreeGroup(nextParentNode.groupId, parseInt(node.groupId, 10));
    } else {
      // A group was dragged - update the groupTree
      // Exclude root group and remove trees from groupTree object
      const newTreeGroups = removeTreesAndTransform(treeData[0].children);
      this.props.onUpdateTreeGroups(newTreeGroups);
    }
  };

  onMouseEnter = evt => {
    const { groupid } = evt.target.dataset;
    this.setState({ hoveredGroupId: groupid });
  };

  onMouseLeave = () => {
    this.setState({ hoveredGroupId: null });
  };

  createGroup(groupId: string) {
    const newTreeGroups = _.cloneDeep(this.props.treeGroups);
    const newGroupId = Utils.randomId();
    const newGroup = makeBasicGroupObject(newGroupId, "");
    if (groupId === MISSING_GROUP_ID) {
      newTreeGroups.push(newGroup);
    } else {
      callDeep(newTreeGroups, groupId, item => {
        item.children.push(newGroup);
      });
    }
    this.props.onUpdateTreeGroups(newTreeGroups);
    this.setState({ renamingGroup: { groupId: newGroupId, name: "" } });
  }

  renameGroup(groupId: string, newName: string) {
    const newTreeGroups = _.cloneDeep(this.props.treeGroups);
    callDeep(newTreeGroups, groupId, item => {
      item.name = newName;
    });
    this.props.onUpdateTreeGroups(newTreeGroups);
  }

  deleteGroup(groupId: string) {
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

  handleDropdownClick = ({ item, key }) => {
    const { groupId, name } = item.props;
    if (key === "create") {
      this.createGroup(groupId);
    } else if (key === "rename") {
      this.setState({ renamingGroup: { groupId, name } });
    } else if (key === "delete") {
      this.deleteGroup(groupId);
    }
  };

  renderGroupActionsDropdown = (node: ExtendedTreeGroupType) => {
    // The root group must not be removed or renamed
    const { groupId, name } = node;
    const isRoot = groupId === MISSING_GROUP_ID;
    const menu = (
      <Menu onClick={this.handleDropdownClick}>
        <Menu.Item key="create" groupId={groupId} name={name}>
          <Icon type="plus" />Create new group
        </Menu.Item>
        <Menu.Item key="rename" groupId={groupId} name={name} disabled={isRoot}>
          <Icon type="tool" />Rename
        </Menu.Item>
        <Menu.Item key="delete" groupId={groupId} name={name} disabled={isRoot}>
          <Icon type="delete" />Delete
        </Menu.Item>
      </Menu>
    );

    // Make sure the displayed name is not empty, otherwise the hover menu won't appear
    const displayableName = name.trim() || "<no name>";

    // Only show the group actions dropdown when hovering
    const isHovering = groupId === this.state.hoveredGroupId;
    const nameAndMaybeDropdown = isHovering ? (
      <Dropdown overlay={menu} placement="bottomCenter">
        <a className="ant-dropdown-link" href="#" onClick={_.noop}>
          {displayableName} <Icon type="setting" />
        </a>
      </Dropdown>
    ) : (
      displayableName
    );

    return (
      <div data-groupid={groupId} onMouseEnter={this.onMouseEnter} onMouseLeave={this.onMouseLeave}>
        <Checkbox
          checked={node.isChecked}
          onChange={this.onCheck}
          node={node}
          style={{ verticalAlign: "middle" }}
        />{" "}
        <Icon type="folder" /> {nameAndMaybeDropdown}
      </div>
    );
  };

  onRenameOk = (newName: string = "") => {
    this.renameGroup(
      this.state.renamingGroup != null ? this.state.renamingGroup.groupId : "",
      newName,
    );
    this.setState({ renamingGroup: null });
  };

  onRenameCancel = () => {
    this.setState({ renamingGroup: null });
  };

  renderRenameModal = () => {
    let newName;
    return (
      <Modal
        title="Rename group"
        visible={this.state.renamingGroup != null}
        onOk={() => this.onRenameOk(newName)}
        onCancel={this.onRenameCancel}
        destroyOnClose
      >
        <Input
          onChange={e => {
            newName = e.target.value;
          }}
          defaultValue={this.state.renamingGroup != null ? this.state.renamingGroup.name : ""}
          onPressEnter={() => this.onRenameOk(newName)}
          ref={input => input != null && input.focus()}
        />
      </Modal>
    );
  };

  generateNodeProps = ({ node }) => {
    // This method can be used to add props to each node of the SortableTree component
    const nodeProps = {};
    if (node.type === TYPE_GROUP) {
      nodeProps.title = this.renderGroupActionsDropdown(node);
    } else {
      const tree = this.props.trees[parseInt(node.groupId, 10)];
      const rgbColorString = tree.color.map(c => Math.round(c * 255)).join(",");
      nodeProps.title = (
        <div data-groupid={node.groupId} onClick={this.onSelect}>
          <Checkbox
            checked={tree.isVisible}
            onChange={this.onCheck}
            node={node}
            style={{ verticalAlign: "middle" }}
          />
          {` ${tree.nodes.size()} `}
          <i className="fa fa-circle" style={{ color: `rgb(${rgbColorString})` }} />
          {` ${tree.name} `}
        </div>
      );
    }
    return nodeProps;
  };

  keySearchMethod({ node, searchQuery }) {
    return node.groupId === searchQuery;
  }

  canDrop({ nextParent }) {
    return nextParent != null && nextParent.type === TYPE_GROUP;
  }

  canDrag({ node }) {
    return node.groupId !== MISSING_GROUP_ID;
  }

  render() {
    return (
      <AutoSizer>
        {({ height, width }) => (
          <div style={{ height, width }}>
            {this.renderRenameModal()}
            <SortableTree
              treeData={this.state.groupTree}
              onChange={this.onChange}
              onMoveNode={this.onMoveNode}
              onVisibilityToggle={this.onExpand}
              searchMethod={this.keySearchMethod}
              searchQuery={`${this.props.activeTreeId}`}
              generateNodeProps={this.generateNodeProps}
              canDrop={this.canDrop}
              canDrag={this.canDrag}
              rowHeight={24}
              innerStyle={{ padding: 0 }}
              scaffoldBlockPxWidth={25}
              searchFocusOffset={0}
              reactVirtualizedListProps={{ scrollToAlignment: "auto" }}
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

export default connect(null, mapDispatchToProps)(TreeHierarchyView);
