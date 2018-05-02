// @flow

import _ from "lodash";
import * as React from "react";
import { connect } from "react-redux";
import { Tree, Modal, Dropdown, Menu, Icon, Input } from "antd";
import { scrollIntoViewIfNeeded } from "scroll-into-view-if-needed";
import {
  setActiveTreeAction,
  toggleTreeAction,
  setTreeGroupsAction,
  setTreeGroupAction,
} from "oxalis/model/actions/skeletontracing_actions";
import Utils from "libs/utils";
import type { TreeType, TreeMapType, TreeGroupType } from "oxalis/store";

const { TreeNode } = Tree;

const MISSING_GROUP_ID = "__none__";

type Props = {
  activeTreeId: number,
  treeGroups: Array<TreeGroupType>,
  sortBy: string,
  trees: TreeMapType,
  onSetActiveTree: number => void,
  onToggleTree: number => void,
  onUpdateTreeGroups: (Array<TreeGroupType>) => void,
  onSetTreeGroup: (?string, number) => void,
};

type State = {
  expandedKeys: Array<string>,
  checkedKeys: Array<string>,
  hoveredKey: ?string,
  groupTree: Array<TreeGroupType>,
  renamingGroup: ?{ groupId: string, name: string },
};

function makeGroupObject(
  groupId: string | number,
  type: "tree" | "group",
  name: string,
  timestamp?: number = 0,
) {
  return {
    groupId: `${groupId}`,
    type,
    name,
    timestamp,
    children: [],
  };
}

function makeGroupObjectFromTree(tree: TreeType) {
  return makeGroupObject(tree.treeId, "tree", tree.name, tree.timestamp);
}

function makeUniqueKey(id: number | string, type: "tree" | "group"): string {
  return `${type}:${id}`;
}

function parseKey(key: string): { id: string, type: "tree" | "group" } {
  const [type, id] = key.split(":");
  return { type: type === "tree" ? "tree" : "group", id };
}

function insertTrees(groups: Array<TreeGroupType>, groupToTreesMap) {
  return groups.map(group => {
    // Ensure that groups are always at the top when sorting by timestamp
    group.timestamp = 0;
    insertTrees(group.children, groupToTreesMap);
    if (groupToTreesMap[group.groupId] != null) {
      group.children = group.children.concat(
        groupToTreesMap[group.groupId].map(makeGroupObjectFromTree),
      );
    }
    return group;
  });
}

function callDeep(
  data: Array<TreeGroupType>,
  key: string,
  callback: Function,
  parentKey: ?string = MISSING_GROUP_ID,
) {
  data.forEach((item: TreeGroupType, index: number, arr: Array<TreeGroupType>) => {
    if (item.groupId === key) {
      callback(item, index, arr, parentKey);
    }
    if (item.children) {
      callDeep(item.children, key, callback, item.groupId);
    }
  });
}

function findNode(group: Array<TreeGroupType>, key: string): ?TreeGroupType {
  let node;
  callDeep(group, key, item => {
    node = item;
  });
  return node;
}

function createGroupToTreesMap(trees: TreeMapType): { [string]: Array<TreeType> } {
  return _.groupBy(trees, tree => (tree.groupId != null ? tree.groupId : MISSING_GROUP_ID));
}

class TreeHierarchyView extends React.PureComponent<Props, State> {
  static getDerivedStateFromProps(nextProps, prevState) {
    const newState = {};

    // Check the trees that are visible
    const checkedKeys = _.filter(nextProps.trees, tree => tree.isVisible).map(tree =>
      makeUniqueKey(`${tree.treeId}`, "tree"),
    );
    if (_.xor(prevState.checkedKeys, checkedKeys).length > 0) {
      newState.checkedKeys = checkedKeys;
    }

    // Insert the trees into the corresponding groups and create a
    // groupTree object that can be rendered using an Antd Tree component
    const groupToTreesMap = createGroupToTreesMap(nextProps.trees);
    const rootGroup = {
      name: "Root",
      groupId: MISSING_GROUP_ID,
      type: "group",
      children: _.cloneDeep(nextProps.treeGroups),
    };
    const generatedGroupTree = insertTrees([rootGroup], groupToTreesMap);
    newState.groupTree = generatedGroupTree;
    return newState;
  }

  state = {
    expandedKeys: [],
    checkedKeys: [],
    hoveredKey: null,
    groupTree: [],
    renamingGroup: null,
  };

  componentDidMount() {
    this.ensureVisible();
  }

  componentDidUpdate(prevProps) {
    if (prevProps.activeTreeId !== this.props.activeTreeId) {
      this.ensureVisible();
    }
  }

  selectedKeyRef = null;

  ensureVisible() {
    // scroll to active tree
    if (this.selectedKeyRef != null) {
      scrollIntoViewIfNeeded(this.selectedKeyRef, { centerIfNeeded: true });
    }
  }

  onExpand = expandedKeys => {
    this.setState({ expandedKeys });
  };

  onCheck = checkedKeys => {
    const oldCheckedKeys = this.state.checkedKeys;
    const toggledKeys = _.xor(checkedKeys, oldCheckedKeys);
    for (const key of toggledKeys) {
      const { id, type } = parseKey(key);
      if (type === "tree") {
        this.props.onToggleTree(parseInt(id, 10));
      }
    }
    this.setState({ checkedKeys });
  };

  onSelect = selectedKeys => {
    // Only one node can be selected at a time
    if (selectedKeys.length > 0) {
      const { id, type } = parseKey(selectedKeys[0]);
      if (type === "tree") {
        this.props.onSetActiveTree(parseInt(id, 10));
      }
    }
  };

  onDrop = ({ node, dragNode, dropToGap }) => {
    // Code based on example from https://ant.design/components/tree/
    const parsedNodeKey = parseKey(node.props.eventKey);
    let { id: droppedGroupId } = parsedNodeKey;
    const { type: droppedGroupType } = parsedNodeKey;
    const { id: draggedGroupId, type: draggedGroupType } = parseKey(dragNode.props.eventKey);

    const { groupTree } = this.state;

    if (dropToGap) {
      // If dropToGap is true the dropKey is that of the sibling element, but we want the key of the parent element
      callDeep(groupTree, droppedGroupId, (item, index, arr, parentKey) => {
        droppedGroupId = parentKey;
      });
    } else if (droppedGroupType === "tree") {
      // Cannot drop on tree nodes, only on groups
      return;
    }

    if (draggedGroupType === "tree") {
      // A tree was dragged - Update group of tree
      this.props.onSetTreeGroup(droppedGroupId, parseInt(draggedGroupId, 10));
    } else {
      // A group was dragged - Update the tree groups object
      const newTreeGroups = _.cloneDeep(this.props.treeGroups);
      // Remove group from old spot
      callDeep(newTreeGroups, draggedGroupId, (item, index, arr) => {
        arr.splice(index, 1);
      });
      // Insert group in new spot
      const draggedGroupWithoutTrees = findNode(this.props.treeGroups, draggedGroupId);
      if (draggedGroupWithoutTrees != null) {
        if (droppedGroupId === MISSING_GROUP_ID) {
          newTreeGroups.push(draggedGroupWithoutTrees);
        } else {
          callDeep(newTreeGroups, droppedGroupId, item => {
            item.children.push(draggedGroupWithoutTrees);
          });
        }
        this.props.onUpdateTreeGroups(newTreeGroups);
      }
    }
  };

  onHover = hoveredKey => {
    this.setState({ hoveredKey });
  };

  createGroup(groupId) {
    const newGroupId = Utils.randomId();
    const newGroup = makeGroupObject(newGroupId, "group", "");
    const newTreeGroups = _.cloneDeep(this.props.treeGroups);
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

  renameGroup(groupId, newName) {
    const newTreeGroups = _.cloneDeep(this.props.treeGroups);
    callDeep(newTreeGroups, groupId, item => {
      item.name = newName;
    });
    this.props.onUpdateTreeGroups(newTreeGroups);
  }

  deleteGroup(groupId) {
    const newTreeGroups = _.cloneDeep(this.props.treeGroups);
    const groupToTreesMap = createGroupToTreesMap(this.props.trees);
    callDeep(newTreeGroups, groupId, (item, index, arr, parentKey) => {
      // Remove group and move its group children to the parent group
      arr.splice(index, 1);
      arr.push(...item.children);
      // Update the group of all its tree children to the parent group
      const trees = groupToTreesMap[groupId] != null ? groupToTreesMap[groupId] : [];
      for (const tree of trees) {
        this.props.onSetTreeGroup(parentKey === MISSING_GROUP_ID ? null : parentKey, tree.treeId);
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

  renderGroupActionsDropdown = (groupName, groupId, key) => {
    // The root group must not be removed or renamed
    const isRoot = groupId === MISSING_GROUP_ID;
    const menu = (
      <Menu onClick={this.handleDropdownClick}>
        <Menu.Item key="create" groupId={groupId} name={groupName}>
          <Icon type="plus" />Create new group
        </Menu.Item>
        <Menu.Item key="rename" groupId={groupId} name={groupName} disabled={isRoot}>
          <Icon type="tool" />Rename
        </Menu.Item>
        <Menu.Item key="delete" groupId={groupId} name={groupName} disabled={isRoot}>
          <Icon type="delete" />Delete
        </Menu.Item>
      </Menu>
    );

    // Only show the group actions dropdown when hovering
    const isHovering = key === this.state.hoveredKey;
    const actions = isHovering ? (
      <Dropdown overlay={menu} placement="bottomCenter">
        <a className="ant-dropdown-link" href="#">
          <Icon type="setting" />
        </a>
      </Dropdown>
    ) : null;

    // Make sure the displayed name is not empty, otherwise the hover menu won't appear
    const displayableName = groupName.trim() || "<no name>";
    return (
      <div onMouseEnter={() => this.onHover(key)} onMouseLeave={() => this.onHover(null)}>
        {displayableName} {actions}
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

  renderRenameModal = () => {
    let newName;
    return (
      <Modal
        title="Rename group"
        visible={this.state.renamingGroup != null}
        onOk={() => this.onRenameOk(newName)}
        onCancel={() => this.setState({ renamingGroup: null })}
        destroyOnClose
      >
        <Input
          onChange={e => {
            newName = e.target.value;
          }}
          defaultValue={this.state.renamingGroup != null ? this.state.renamingGroup.name : ""}
          onPressEnter={() => this.onRenameOk(newName)}
          autoFocus
        />
      </Modal>
    );
  };

  renderTreeNodes = data =>
    _.orderBy(data, [this.props.sortBy], ["asc"]).map(node => {
      const key = makeUniqueKey(node.groupId, node.type);
      if (node.type === "group") {
        return (
          <TreeNode title={this.renderGroupActionsDropdown(node.name, node.groupId, key)} key={key}>
            {this.renderTreeNodes(node.children)}
          </TreeNode>
        );
      } else {
        const tree = this.props.trees[parseInt(node.groupId, 10)];
        const rgbColorString = tree.color.map(c => Math.round(c * 255)).join(",");

        return (
          <TreeNode
            title={
              <React.Fragment>
                {`${tree.nodes.size()}  `}
                <i className="fa fa-circle" style={{ color: `rgb(${rgbColorString})` }} />
                {`${tree.name} `}
              </React.Fragment>
            }
            key={key}
            ref={ref => {
              if (ref != null && tree.treeId === this.props.activeTreeId) {
                // $FlowFixMe Antd components have the selectHandle property which contains the DOM reference
                this.selectedKeyRef = ref.selectHandle;
              }
            }}
          />
        );
      }
    });

  render() {
    return (
      <React.Fragment>
        {this.renderRenameModal()}
        <Tree
          checkable
          draggable
          showLine
          onDrop={this.onDrop}
          onExpand={this.onExpand}
          expandedKeys={this.state.expandedKeys}
          defaultExpandAll
          autoExpandParent={false}
          onCheck={this.onCheck}
          checkedKeys={this.state.checkedKeys}
          onSelect={this.onSelect}
          selectedKeys={[makeUniqueKey(`${this.props.activeTreeId}`, "tree")]}
        >
          {this.renderTreeNodes(this.state.groupTree)}
        </Tree>
      </React.Fragment>
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
  onUpdateTreeGroups(treeGroups) {
    dispatch(setTreeGroupsAction(treeGroups));
  },
  onSetTreeGroup(groupId, treeId) {
    dispatch(setTreeGroupAction(groupId, treeId));
  },
});

export default connect(null, mapDispatchToProps)(TreeHierarchyView);
