import _ from "lodash";
import { mapGroupsWithRoot } from "oxalis/model/accessors/skeletontracing_accessor";
import type { Tree, TreeGroup, SegmentMap, Segment, TreeMap, SegmentGroup } from "oxalis/store";
export const MISSING_GROUP_ID = -1;
export const TYPE_GROUP = "GROUP";
export const TYPE_TREE = "TREE";
const GroupTypeEnum = {
  [TYPE_GROUP]: TYPE_GROUP,
  [TYPE_TREE]: TYPE_TREE,
};

type TreeOrGroup = keyof typeof GroupTypeEnum;
export type TreeNode = {
  title: string;
  id: number;
  expanded: boolean;
  isChecked: boolean;
  isIndeterminate: boolean;
  containsTrees: boolean;
  timestamp: number;
  type: TreeOrGroup;
  children: Array<TreeNode>;
};
export function makeBasicGroupObject(
  groupId: number,
  name: string,
  children: Array<TreeGroup> = [],
): TreeGroup {
  return {
    groupId,
    name,
    children,
  };
}

function makeTreeNode(
  id: number,
  name: string,
  type: TreeOrGroup,
  optionalProperties: Partial<TreeNode>,
): TreeNode {
  return {
    id,
    type,
    title: name,
    timestamp: 0,
    isChecked: false,
    isIndeterminate: false,
    containsTrees: false,
    children: [],
    expanded: true,
    ...optionalProperties,
  };
}

function makeTreeNodeFromTree(tree: Tree): TreeNode {
  return makeTreeNode(tree.treeId, tree.name, TYPE_TREE, {
    timestamp: tree.timestamp,
    isChecked: tree.isVisible,
    containsTrees: true,
  });
}

function makeTreeNodeFromGroup(group: TreeGroup, optionalProperties: Partial<TreeNode>): TreeNode {
  return makeTreeNode(group.groupId, group.name, TYPE_GROUP, optionalProperties);
}

export function removeTreesAndTransform(groupTree: Array<TreeNode>): Array<TreeGroup> {
  // Remove all trees from the group hierarchy and transform groups to their basic form
  return _.filter(groupTree, (treeNode) => treeNode.type === TYPE_GROUP).map((group) =>
    makeBasicGroupObject(group.id, group.title, removeTreesAndTransform(group.children)),
  );
}
export function insertTreesAndTransform(
  groups: Array<TreeGroup>,
  groupToTreesMap: Record<number, Array<Tree>>,
  expandedGroupIds: Record<number, boolean>,
  sortBy: string,
): Array<TreeNode> {
  // Insert all trees into their respective groups in the group hierarchy and transform groups to tree nodes
  return groups.map((group) => {
    const { groupId } = group;
    const treeNode = makeTreeNodeFromGroup(group, {
      // Ensure that groups are always at the top when sorting by timestamp
      timestamp: 0,
      expanded: expandedGroupIds[groupId] != null ? expandedGroupIds[groupId] : false,
      children: insertTreesAndTransform(group.children, groupToTreesMap, expandedGroupIds, sortBy),
    });

    // Groups are always sorted by name and appear before the trees, trees are sorted according to the sortBy prop
    const trees = _.orderBy(groupToTreesMap[groupId] || [], [sortBy], ["asc"]).map(
      makeTreeNodeFromTree,
    );

    treeNode.children = _.orderBy(treeNode.children, ["name"], ["asc"]).concat(trees);
    treeNode.isChecked = _.every(
      treeNode.children, // Groups that don't contain any trees should not influence the state of their parents
      (groupOrTree) => groupOrTree.isChecked || !groupOrTree.containsTrees,
    );
    treeNode.isIndeterminate = treeNode.isChecked
      ? false
      : _.some(
          treeNode.children, // Groups that don't contain any trees should not influence the state of their parents
          (groupOrTree) =>
            (groupOrTree.isChecked || groupOrTree.isIndeterminate) && groupOrTree.containsTrees,
        );
    treeNode.containsTrees =
      trees.length > 0 || _.some(treeNode.children, (groupOrTree) => groupOrTree.containsTrees);
    return treeNode;
  });
}
export function callDeep(
  groups: Array<TreeGroup>,
  groupId: number,
  callback: (
    group: TreeGroup,
    index: number,
    treeGroups: Array<TreeGroup>,
    parentGroupId: number | null | undefined,
  ) => void,
  parentGroupId: number | null | undefined = MISSING_GROUP_ID,
) {
  // Deeply traverse the group hierarchy and execute the callback function when the treeNode with id groupId is found
  groups.forEach((group: TreeGroup, index: number, array: Array<TreeGroup>) => {
    if (group.groupId === groupId) {
      callback(group, index, array, parentGroupId);
    } else if (group.children) {
      callDeep(group.children, groupId, callback, group.groupId);
    }
  });
}
export function callDeepWithChildren(
  groups: Array<TreeGroup>,
  groupId: number | undefined,
  callback: (
    group: TreeGroup,
    index: number,
    treeGroups: Array<TreeGroup>,
    parentGroupId: number | null | undefined,
  ) => void,
  parentGroupId: number | null | undefined = MISSING_GROUP_ID,
  isWithinTargetGroup: boolean = false,
) {
  // Deeply traverse the group hierarchy and execute the callback function when the treeNode with id groupId is found
  groups.forEach((group: TreeGroup, index: number, array: Array<TreeGroup>) => {
    const shouldVisit = isWithinTargetGroup || group.groupId === groupId;

    if (shouldVisit) {
      callback(group, index, array, parentGroupId);
    }

    if (group.children) {
      callDeepWithChildren(group.children, groupId, callback, group.groupId, shouldVisit);
    }
  });
}

export function findGroup(groups: Array<TreeGroup>, groupId: number): TreeGroup | null | undefined {
  let foundGroup = null;
  callDeep(groups, groupId, (group, _index, _groups) => {
    foundGroup = group;
  });
  return foundGroup;
}

export function findParentIdForGroupId(
  groups: Array<TreeGroup>,
  groupId: number,
): number | undefined | null {
  let foundParentGroupId: number | undefined | null = null;
  callDeep(groups, groupId, (_group, _index, _groups, parentGroupId) => {
    foundParentGroupId = parentGroupId;
  });
  return foundParentGroupId;
}

export function forEachTreeNode(groups: Array<TreeNode>, callback: (arg0: TreeNode) => void) {
  for (const group of groups) {
    callback(group);

    if (group.children) {
      forEachTreeNode(group.children, callback);
    }
  }
}
export function anySatisfyDeep(groups: Array<TreeNode>, testFunction: (arg0: TreeNode) => boolean) {
  for (const group of groups) {
    if (testFunction(group)) {
      return true;
    }

    if (group.children) {
      if (anySatisfyDeep(group.children, testFunction)) {
        return true;
      }
    }
  }

  return false;
}
export function findTreeNode(
  groups: Array<TreeNode>,
  id: number,
  callback: (arg0: TreeNode) => any,
) {
  for (const group of groups) {
    if (group.id === id) {
      callback(group);
    } else if (group.children) {
      findTreeNode(group.children, id, callback);
    }
  }
}

export function createGroupToTreesMap(trees: TreeMap): Record<number, Array<Tree>> {
  return _.groupBy(trees, (tree) => (tree.groupId != null ? tree.groupId : MISSING_GROUP_ID));
}

export function createGroupToSegmentsMap(segments: SegmentMap): Record<number, Segment[]> {
  const groupToSegments: Record<number, Segment[]> = {};
  for (const segment of segments.values()) {
    const { groupId } = segment;
    const keyId = groupId || MISSING_GROUP_ID;

    groupToSegments[keyId] ||= [];
    groupToSegments[keyId].push(segment);
  }

  return groupToSegments;
}

export function getGroupByIdWithSubgroups(
  treeGroups: Array<TreeGroup>,
  groupId: number | undefined,
): Array<number> {
  const groupWithSubgroups: number[] = [];
  callDeepWithChildren(treeGroups, groupId, (treeGroup) => {
    groupWithSubgroups.push(treeGroup.groupId);
  });
  return groupWithSubgroups;
}

export function moveGroupsHelper(
  groups: TreeGroup[] | SegmentGroup[],
  groupId: number,
  targetGroupId: number | null | undefined,
): TreeGroup[] | SegmentGroup[] {
  const movedGroup = findGroup(groups, groupId);
  if (!movedGroup) {
    throw new Error("Could not find group to move");
  }

  const groupsWithoutDraggedGroup = mapGroupsWithRoot(groups, (parentGroup) => ({
    ...parentGroup,
    children: parentGroup.children.filter((subgroup) => subgroup.groupId !== movedGroup.groupId),
  }));
  const newGroups = mapGroupsWithRoot(groupsWithoutDraggedGroup, (parentGroup) => ({
    ...parentGroup,
    children:
      parentGroup.groupId === targetGroupId
        ? parentGroup.children.concat([movedGroup])
        : parentGroup.children,
  }));
  return newGroups;
}
