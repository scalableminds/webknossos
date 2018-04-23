// @flow

import _ from "lodash";
import * as React from "react";
import { connect } from "react-redux";
import { Tree } from "antd";
import {
  setActiveTreeAction,
  toggleTreeAction,
  setTreeGroupsAction,
  setTreeGroupAction,
} from "oxalis/model/actions/skeletontracing_actions";

const { TreeNode } = Tree;

type Props = {
  treeGroups: Object,
};

type State = {
  expandedKeys: Array<string>,
  checkedKeys: Array<string>,
  autoExpandParent: boolean,
};

function* iterateGroups(groups) {
  if (groups == null || groups.length == null || groups.length === 0) {
    return;
  }

  for (const group of groups) {
    if (group.type === "group") yield group.key;

    if (group.children) {
      yield* iterateGroups(group.children);
    }
  }
}

function buildGroupToTreesMap(trees) {
  const groupToTreesMap = {};
  for (const treeId of Object.keys(trees)) {
    let group = trees[treeId].group;
    if (group == null) {
      group = "__none__";
    }
    if (groupToTreesMap[group] == null) {
      groupToTreesMap[group] = [treeId];
    } else {
      groupToTreesMap[group].push(treeId);
    }
  }
  return groupToTreesMap;
}

function insertTrees(group, groupToTreesMap) {
  for (const child of group.children) {
    insertTrees(child, groupToTreesMap);
  }
  if (groupToTreesMap[group.key] != null) {
    group.children = group.children.concat(
      groupToTreesMap[group.key].map(treeId => ({ key: `${treeId}`, type: "tree" })),
    );
  }
  return group;
}

class TreeHierarchyView extends React.PureComponent<Props, State> {
  static getDerivedStateFromProps(nextProps, prevState) {
    const newState = {};
    const checkedKeys = _.filter(nextProps.trees, tree => tree.isVisible).map(
      tree => `${tree.treeId}`,
    );
    const expandedKeys = _.map(nextProps.trees, tree => `${tree.treeId}`).concat(
      Array.from(iterateGroups([nextProps.treeGroups])),
    );

    const groupToTreesMap = buildGroupToTreesMap(nextProps.trees);
    const generatedGroupTree = [
      insertTrees(_.cloneDeep(nextProps.treeGroups), groupToTreesMap),
      ...(groupToTreesMap.__none__ != null
        ? groupToTreesMap.__none__.map(treeId => ({ key: `${treeId}`, type: "tree" }))
        : []),
    ];
    newState.groupTree = generatedGroupTree;

    if (_.xor(prevState.checkedKeys, checkedKeys).length > 0) {
      newState.checkedKeys = checkedKeys;
    }
    if (_.size(prevState.expandedKeys) === 0) {
      newState.expandedKeys = expandedKeys;
    }
    return _.size(newState) > 0 ? newState : null;
  }

  state = {
    expandedKeys: [],
    checkedKeys: [],
    autoExpandParent: true,
  };

  onExpand = expandedKeys => {
    // autoExpandParent needs to be set to false, otherwise the parent can not collapse if one of its children is expanded.
    this.setState({
      expandedKeys,
      autoExpandParent: false,
    });
  };

  onCheck = checkedKeys => {
    const oldCheckedKeys = this.state.checkedKeys;
    const toggledKeys = _.xor(checkedKeys, oldCheckedKeys);
    for (const key of toggledKeys) {
      const possibleTreeId = parseInt(key, 10);
      if (_.isFinite(possibleTreeId)) {
        this.props.onToggleTree(possibleTreeId);
      }
    }
    this.setState({ checkedKeys });
  };

  onSelect = selectedKeys => {
    const possibleTreeId = parseInt(selectedKeys[0], 10);
    if (_.isFinite(possibleTreeId)) {
      this.props.onSetActiveTree(possibleTreeId);
    }
  };

  onDrop = info => {
    // Code based on example from https://ant.design/components/tree/
    console.log(info);
    let dropKey = info.node.props.eventKey;
    const dragKey = info.dragNode.props.eventKey;

    // const dragNodesKeys = info.dragNodesKeys;
    const loop = (data, key, callback, parentKey = "__none__") => {
      data.forEach((item, index, arr) => {
        if (item.key === key) {
          return callback(item, index, arr, parentKey);
        }
        if (item.children) {
          return loop(item.children, key, callback, item.key);
        }
      });
    };
    const groupTree = this.state.groupTree;

    if (!info.dropToGap) {
      // Cannot drop on tree nodes, only on groups
      let dropItem;
      loop(groupTree, dropKey, item => {
        dropItem = item;
      });
      if (dropItem.type === "tree") return;
    } else {
      // If dropToGap is true the dropKey is that of the sibling element, but we want the key of the parent element
      loop(groupTree, dropKey, (item, index, arr, parentKey) => {
        dropKey = parentKey;
      });
    }

    let dragObj;
    loop(groupTree, dragKey, item => {
      dragObj = item;
    });
    if (dragObj.type === "tree") {
      console.log("Updated group of tree");
      this.props.onSetTreeGroup(dropKey, parseInt(dragKey, 10));
    } else {
      const newTreeGroups = _.cloneDeep(this.props.treeGroups);
      loop(newTreeGroups, dragKey, (item, index, arr) => {
        arr.splice(index, 1);
      });
      loop(newTreeGroups, dropKey, item => {
        item.children = item.children || [];
        item.children.push(dragObj);
      });
      console.log("Updated groups");
      this.props.onUpdateTreeGroups(newTreeGroups);
    }
  };

  renderTreeNodes = data =>
    data.map(node => {
      if (node.type === "group") {
        if (node.children) {
          return (
            <TreeNode title={node.name} key={node.key} dataRef={node}>
              {this.renderTreeNodes(node.children)}
            </TreeNode>
          );
        }
        return <TreeNode {...node} />;
      } else {
        const tree = this.props.trees[parseInt(node.key, 10)];
        return (
          <TreeNode
            title={`${tree.nodes.size()} - ${tree.name}`}
            key={tree.treeId}
            dataRef={tree}
          />
        );
      }
    });

  render() {
    return (
      <Tree
        checkable
        draggable
        showLine
        onDrop={this.onDrop}
        onExpand={this.onExpand}
        expandedKeys={this.state.expandedKeys}
        autoExpandParent={this.state.autoExpandParent}
        onCheck={this.onCheck}
        checkedKeys={this.state.checkedKeys}
        onSelect={this.onSelect}
        selectedKeys={[`${this.props.activeTreeId}`]}
      >
        {this.renderTreeNodes(this.state.groupTree)}
      </Tree>
    );
  }
}

const mapStateToProps = (state: OxalisState) => ({
  activeTreeId: state.tracing.activeTreeId,
});

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
  onSetTreeGroup(group, treeId) {
    dispatch(setTreeGroupAction(group, treeId));
  },
});

export default connect(mapStateToProps, mapDispatchToProps)(TreeHierarchyView);
