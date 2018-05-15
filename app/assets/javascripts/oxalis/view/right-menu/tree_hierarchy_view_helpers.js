// @flow

import _ from "lodash";
import type { TreeType, TreeMapType, TreeGroupType, TreeGroupBaseType } from "oxalis/store";

export const MISSING_GROUP_ID = -1;

export const TYPE_GROUP = "GROUP";
export const TYPE_TREE = "TREE";
const GroupTypeEnum = {
  [TYPE_GROUP]: TYPE_GROUP,
  [TYPE_TREE]: TYPE_TREE,
};
type TreeOrGroupType = $Keys<typeof GroupTypeEnum>;

export type ExtendedTreeGroupType = TreeGroupBaseType & {
  expanded: boolean,
  isChecked: boolean,
  timestamp: number,
  type: TreeOrGroupType,
  children: Array<ExtendedTreeGroupType>,
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

function makeExtendedGroupObject(
  groupId: number,
  name: string,
  type: TreeOrGroupType,
  optionalProperties: $Shape<ExtendedTreeGroupType>,
): ExtendedTreeGroupType {
  return _.extend(
    {
      groupId,
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

function makeExtendedGroupObjectFromTree(tree: TreeType): ExtendedTreeGroupType {
  return makeExtendedGroupObject(tree.treeId, tree.name, TYPE_TREE, {
    timestamp: tree.timestamp,
    isChecked: tree.isVisible,
  });
}

function makeExtendedGroupObjectFromGroup(
  group: TreeGroupType,
  optionalProperties: $Shape<ExtendedTreeGroupType>,
): ExtendedTreeGroupType {
  return makeExtendedGroupObject(group.groupId, group.name, TYPE_GROUP, optionalProperties);
}

export function removeTreesAndTransform(
  groupTree: Array<ExtendedTreeGroupType>,
): Array<TreeGroupType> {
  // Remove all trees from the group hierarchy and transform groups to their basic form
  return _.filter(groupTree, group => group.type === TYPE_GROUP).map(group =>
    makeBasicGroupObject(group.groupId, group.name, removeTreesAndTransform(group.children)),
  );
}

export function insertTreesAndTransform(
  groups: Array<TreeGroupType>,
  groupToTreesMap: { [number]: Array<TreeType> },
  expandedGroupIds: { [number]: boolean },
  sortBy: string,
): Array<ExtendedTreeGroupType> {
  // Insert all trees into their respective groups in the group hierarchy and transform groups to their extended form
  return groups.map(group => {
    const { groupId } = group;
    const transformedGroup = makeExtendedGroupObjectFromGroup(group, {
      // Ensure that groups are always at the top when sorting by timestamp
      timestamp: 0,
      expanded: expandedGroupIds[groupId] != null ? expandedGroupIds[groupId] : true,
      children: insertTreesAndTransform(group.children, groupToTreesMap, expandedGroupIds, sortBy),
    });
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

export function callDeep(
  groups: Array<TreeGroupType>,
  groupId: number,
  callback: (TreeGroupType, number, Array<TreeGroupType>, ?number) => void,
  parentGroupId: ?number = MISSING_GROUP_ID,
) {
  // Deeply traverse the group hierarchy and execute the callback function when the group with id groupId is found
  groups.forEach((group: TreeGroupType, index: number, array: Array<TreeGroupType>) => {
    if (group.groupId === groupId) {
      callback(group, index, array, parentGroupId);
    }
    if (group.children) {
      callDeep(group.children, groupId, callback, group.groupId);
    }
  });
}

export function createGroupToTreesMap(trees: TreeMapType): { [number]: Array<TreeType> } {
  return _.groupBy(trees, tree => (tree.groupId != null ? tree.groupId : MISSING_GROUP_ID));
}
