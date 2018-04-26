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
  groupTree: Array<TreeGroupType>,
  renamingGroup: ?{ groupId: string, name: string },
};

function makeGroupObjectFromTree(tree: TreeType) {
  return {
    groupId: `${tree.treeId}`,
    type: "tree",
    name: tree.name,
    timestamp: tree.timestamp,
    children: [],
  };
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

function walk(
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
      walk(item.children, key, callback, item.groupId);
    }
  });
}

function findNode(group: Array<TreeGroupType>, key: string): ?TreeGroupType {
  let node;
  walk(group, key, item => {
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
    const checkedKeys = _.filter(nextProps.trees, tree => tree.isVisible).map(
      tree => `${tree.treeId}`,
    );
    if (_.xor(prevState.checkedKeys, checkedKeys).length > 0) {
      newState.checkedKeys = checkedKeys;
    }

    // Insert the trees into the corresponding groups and create a
    // groupTree object that can be rendered using an Antd Tree component
    const groupToTreesMap = createGroupToTreesMap(nextProps.trees);
    if (groupToTreesMap[MISSING_GROUP_ID] == null) groupToTreesMap[MISSING_GROUP_ID] = [];
    const generatedGroupTree = insertTrees(
      _.cloneDeep(nextProps.treeGroups),
      groupToTreesMap,
    ).concat(...groupToTreesMap[MISSING_GROUP_ID].map(makeGroupObjectFromTree));
    newState.groupTree = generatedGroupTree;

    return newState;
  }

  state = {
    expandedKeys: [],
    checkedKeys: [],
    groupTree: [],
    renamingGroup: null,
  };

  componentDidUpdate() {
    this.ensureVisible();
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
      const node = findNode(this.state.groupTree, key);
      if (node != null && node.type === "tree") {
        this.props.onToggleTree(parseInt(node.groupId, 10));
      }
    }
    this.setState({ checkedKeys });
  };

  onSelect = (selectedKeys, { node }) => {
    if (node.props.type === "tree") {
      // Only one node can be selected at a time
      this.props.onSetActiveTree(parseInt(selectedKeys[0], 10));
    }
  };

  onDrop = ({ node, dragNode, dropToGap }) => {
    // Code based on example from https://ant.design/components/tree/
    let dropKey = node.props.eventKey;
    const dragKey = dragNode.props.eventKey;

    const { groupTree } = this.state;

    if (dropToGap) {
      // If dropToGap is true the dropKey is that of the sibling element, but we want the key of the parent element
      walk(groupTree, dropKey, (item, index, arr, parentKey) => {
        dropKey = parentKey;
      });
    } else if (node.props.type === "tree") {
      // Cannot drop on tree nodes, only on groups
      return;
    }

    if (dragNode.props.type === "tree") {
      // A tree was dragged - Update group of tree
      this.props.onSetTreeGroup(dropKey, parseInt(dragKey, 10));
    } else {
      // A group was dragged - Update the tree groups object
      const newTreeGroups = _.cloneDeep(this.props.treeGroups);
      // Remove group from old spot
      walk(newTreeGroups, dragKey, (item, index, arr) => {
        arr.splice(index, 1);
      });
      // Insert group in new spot
      const dragObjWithoutTrees = findNode(this.props.treeGroups, dragKey);
      if (dragObjWithoutTrees != null) {
        if (dropKey === MISSING_GROUP_ID) {
          newTreeGroups.push(dragObjWithoutTrees);
        } else {
          walk(newTreeGroups, dropKey, item => {
            item.children.push(dragObjWithoutTrees);
          });
        }
        this.props.onUpdateTreeGroups(newTreeGroups);
      }
    }
  };

  renameGroup(groupId, newName) {
    const newTreeGroups = _.cloneDeep(this.props.treeGroups);
    walk(newTreeGroups, groupId, item => {
      item.name = newName;
    });
    this.props.onUpdateTreeGroups(newTreeGroups);
  }

  deleteGroup(groupId) {
    const newTreeGroups = _.cloneDeep(this.props.treeGroups);
    const groupToTreesMap = createGroupToTreesMap(this.props.trees);
    walk(newTreeGroups, groupId, (item, index, arr, parentKey) => {
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
    if (key === "rename") {
      this.setState({ renamingGroup: { groupId, name } });
    } else if (key === "delete") {
      this.deleteGroup(groupId);
    }
  };

  renderGroupActionsDropdown = (groupName, groupId) => {
    const menu = (
      <Menu onClick={this.handleDropdownClick}>
        <Menu.Item key="rename" groupId={groupId} name={groupName}>
          <Icon type="tool" />Rename
        </Menu.Item>
        <Menu.Item key="delete" groupId={groupId} name={groupName}>
          <Icon type="delete" />Delete
        </Menu.Item>
      </Menu>
    );

    return (
      <React.Fragment>
        {groupName}{" "}
        <Dropdown overlay={menu}>
          <a className="ant-dropdown-link" href="#">
            <Icon type="setting" />
          </a>
        </Dropdown>
      </React.Fragment>
    );
  };

  onRenameOk = newName => {
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
      >
        <Input
          onChange={e => {
            newName = e.target.value;
          }}
          defaultValue={this.state.renamingGroup != null ? this.state.renamingGroup.name : ""}
          onPressEnter={() => this.onRenameOk(newName)}
        />
      </Modal>
    );
  };

  renderTreeNodes = data =>
    _.orderBy(data, [this.props.sortBy], ["asc"]).map(node => {
      if (node.type === "group") {
        const children = node.children != null ? this.renderTreeNodes(node.children) : null;

        return (
          <TreeNode
            title={this.renderGroupActionsDropdown(node.name, node.groupId)}
            key={node.groupId}
            type="group"
          >
            {children}
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
            key={node.groupId}
            type="tree"
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
          selectedKeys={[`${this.props.activeTreeId}`]}
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
