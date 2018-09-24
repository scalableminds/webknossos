// @flow

import _ from "lodash";
import type { TreeType, TreeMapType, TreeGroupType } from "oxalis/store";

export const MISSING_GROUP_ID = -1;

export const TYPE_GROUP = "GROUP";
export const TYPE_TREE = "TREE";
const GroupTypeEnum = {
  [TYPE_GROUP]: TYPE_GROUP,
  [TYPE_TREE]: TYPE_TREE,
};
type TreeOrGroupType = $Keys<typeof GroupTypeEnum>;

export type TreeNodeType = {
  name: string,
  id: number,
  expanded: boolean,
  isChecked: boolean,
  timestamp: number,
  type: TreeOrGroupType,
  children: Array<TreeNodeType>,
};

export function makeBasicGroupObject(
  groupId: number,
  name: string,
  children: Array<TreeGroupType> = [],
): TreeGroupType {
  return {
    groupId,
    name,
    children,
  };
}

function makeTreeNode(
  id: number,
  name: string,
  type: TreeOrGroupType,
  optionalProperties: $Shape<TreeNodeType>,
): TreeNodeType {
  return _.extend(
    {
      id,
      type,
      name,
      timestamp: 0,
      isChecked: false,
      children: [],
      expanded: true,
    },
    optionalProperties,
  );
}

function makeTreeNodeFromTree(tree: TreeType): TreeNodeType {
  return makeTreeNode(tree.treeId, tree.name, TYPE_TREE, {
    timestamp: tree.timestamp,
    isChecked: tree.isVisible,
  });
}

function makeTreeNodeFromGroup(
  group: TreeGroupType,
  optionalProperties: $Shape<TreeNodeType>,
): TreeNodeType {
  return makeTreeNode(group.groupId, group.name, TYPE_GROUP, optionalProperties);
}

export function removeTreesAndTransform(groupTree: Array<TreeNodeType>): Array<TreeGroupType> {
  // Remove all trees from the group hierarchy and transform groups to their basic form
  return _.filter(groupTree, treeNode => treeNode.type === TYPE_GROUP).map(group =>
    makeBasicGroupObject(group.id, group.name, removeTreesAndTransform(group.children)),
  );
}

export function insertTreesAndTransform(
  groups: Array<TreeGroupType>,
  groupToTreesMap: { [number]: Array<TreeType> },
  expandedGroupIds: { [number]: boolean },
  sortBy: string,
): Array<TreeNodeType> {
  // Insert all trees into their respective groups in the group hierarchy and transform groups to tree nodes
  return groups.map(group => {
    const { groupId } = group;
    const treeNode = makeTreeNodeFromGroup(group, {
      // Ensure that groups are always at the top when sorting by timestamp
      timestamp: 0,
      expanded: expandedGroupIds[groupId] != null ? expandedGroupIds[groupId] : true,
      children: insertTreesAndTransform(group.children, groupToTreesMap, expandedGroupIds, sortBy),
    });
    if (groupToTreesMap[groupId] != null) {
      // Groups are always sorted by name and appear before the trees, trees are sorted according to the sortBy prop
      treeNode.children = _.orderBy(treeNode.children, ["name"], ["asc"]).concat(
        _.orderBy(groupToTreesMap[groupId], [sortBy], ["asc"]).map(makeTreeNodeFromTree),
      );
    }
    treeNode.isChecked = _.every(treeNode.children, groupOrTree => groupOrTree.isChecked);
    return treeNode;
  });
}

export function callDeep(
  groups: Array<TreeGroupType>,
  groupId: number,
  callback: (TreeGroupType, number, Array<TreeGroupType>, ?number) => void,
  parentGroupId: ?number = MISSING_GROUP_ID,
) {
  // Deeply traverse the group hierarchy and execute the callback function when the treeNode with id groupId is found
  groups.forEach((group: TreeGroupType, index: number, array: Array<TreeGroupType>) => {
    if (group.groupId === groupId) {
      callback(group, index, array, parentGroupId);
    }
    if (group.children) {
      callDeep(group.children, groupId, callback, group.groupId);
    }
  });
}

export function findGroup(groups: Array<TreeGroupType>, groupId: number): ?TreeGroupType {
  let foundGroup = null;
  callDeep(groups, groupId, group => {
    foundGroup = group;
  });
  return foundGroup;
}

export function createGroupToTreesMap(trees: TreeMapType): { [number]: Array<TreeType> } {
  return _.groupBy(trees, tree => (tree.groupId != null ? tree.groupId : MISSING_GROUP_ID));
}
